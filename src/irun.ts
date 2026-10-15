import { setTimeout as attendre } from "node:timers/promises";

const BASE = "https://www.i-run.fr";

// Le site est derrière Akamai : sans en-têtes de navigateur, la réponse est un 403
const ENTETES = {
    "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
    accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "accept-language": "fr-FR,fr;q=0.9,en;q=0.8",
};

// "availableOtherSize" : épuisé dans ce coloris, disponible seulement dans un autre
const EN_STOCK = new Set(["available", "lastOnes"]);

// Garde-fous du parcours d'une recherche (60 résultats par page)
const PAGES_MAX = 10;
const PAUSE_ENTRE_PAGES_MS = 3_000;
const IDS_PAR_REQUETE_STOCK = 40;

export type Genre = "homme" | "femme" | "tous";

export interface Variante {
    id: number;
    nom: string;
    url: string;
    prix: number;
    prixConseille: number;
    image?: string;
    // Pointures en stock
    pointures: string[];
}

// Ce qui est surveillé : une fiche produit, ou tous les résultats d'une recherche
export interface Suivi {
    nom: string;
    variantes: Variante[];
}

async function telecharger(url: string): Promise<string> {
    const reponse = await fetch(url, { headers: ENTETES, signal: AbortSignal.timeout(30_000) });
    if (reponse.status === 403) throw new Error(`403 sur ${url} (bloqué par la protection anti-robot)`);
    if (!reponse.ok) throw new Error(`HTTP ${reponse.status} sur ${url}`);
    // Les pages sont servies en ISO-8859-1
    const charset = /charset=([\w-]+)/i.exec(reponse.headers.get("content-type") ?? "")?.[1] ?? "utf-8";
    return new TextDecoder(charset).decode(await reponse.arrayBuffer());
}

function decoderEntites(texte: string): string {
    return texte
        .replace(/&euro;/g, "€")
        .replace(/&nbsp;/g, " ")
        .replace(/&apos;|&#39;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, "&")
        .replace(/\s+/g, " ")
        .trim();
}

function lirePrix(texte: string | undefined): number | undefined {
    const brut = texte && /([\d\s.]+(?:,\d{1,2})?)\s*&euro;/.exec(texte)?.[1];
    if (!brut) return undefined;
    const prix = Number(brut.replace(/[\s.]/g, "").replace(",", "."));
    return Number.isFinite(prix) && prix > 0 ? prix : undefined;
}

// Minuscules sans accents, découpé en mots : "Next% 3" -> ["next", "3"]
function mots(texte: string): string[] {
    return texte
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(Boolean);
}

async function lireStock(ids: number[]): Promise<Map<number, string[]>> {
    const stock = new Map<number, string[]>();
    for (let i = 0; i < ids.length; i += IDS_PAR_REQUETE_STOCK) {
        const lot = ids.slice(i, i + IDS_PAR_REQUETE_STOCK);
        const donnees = JSON.parse(await telecharger(`${BASE}/productStock-${lot.join(",")}.html`)) as {
            id: number;
            data?: { label: string; stockStatus?: { state?: string } }[];
        }[];
        for (const variante of donnees) {
            const disponibles = (variante.data ?? []).filter((t) => EN_STOCK.has(t.stockStatus?.state ?? "")).map((t) => t.label);
            stock.set(variante.id, disponibles);
        }
    }
    return stock;
}

async function ajouterStock(nom: string, variantes: Omit<Variante, "pointures">[]): Promise<Variante[]> {
    try {
        const stock = await lireStock(variantes.map((v) => v.id));
        return variantes.map((v) => ({ ...v, pointures: stock.get(v.id) ?? [] }));
    } catch (e) {
        throw new Error(`Stock illisible pour ${nom} : ${e instanceof Error ? e.message : String(e)}`);
    }
}

async function lireFiche(url: string): Promise<Suivi> {
    const html = await telecharger(url);
    if (!/data-product-id="\d+"/.test(html)) throw new Error(`Pas de fiche produit sur ${url} (modèle retiré ou URL changée ?)`);

    const marque = /prdDtl__header__brand">([^<]*)</.exec(html)?.[1] ?? "";
    const sousTitre = /prdDtl__header__subTitle">([^<]*)</.exec(html)?.[1] ?? "";
    const nom = decoderEntites(`${marque} ${sousTitre}`) || url;

    const lues: { id: number; url: string; prix: number; image?: string }[] = [];
    for (const bloc of html.split(/<li id="(?=\d+" class="prdDtl__variant__listItem)/).slice(1)) {
        const contenu = bloc.slice(0, bloc.indexOf("</li>"));
        const id = Number(/^\d+/.exec(contenu)?.[0]);
        const href = /<a href="([^"]+)"/.exec(contenu)?.[1];
        const prix = lirePrix(/prdDtl__variant__price[^>]*>([^<]+)</.exec(contenu)?.[1]);
        if (!id || !href || !prix) continue;
        lues.push({ id, url: new URL(decoderEntites(href), BASE).href, prix, image: /<img[^>]+src="([^"]+)"/.exec(contenu)?.[1] });
    }
    if (lues.length === 0) {
        // Modèle à un seul coloris : pas de liste de variantes, seulement le prix principal
        const id = Number(/data-current-variant-id="(\d+)"/.exec(html)?.[1]);
        const prix = lirePrix(/prdDtl__priceZone__price__value[^>]*>([^<]+)</.exec(html)?.[1]);
        const image = /<meta property="og:image" content="([^"]+)"/.exec(html)?.[1];
        if (id && prix) lues.push({ id, url, prix, image });
    }
    if (lues.length === 0) throw new Error(`Aucun prix trouvé sur ${url} (structure de page modifiée ?)`);

    // Le prix conseillé n'est affiché que si le coloris courant est remisé : sinon, prix le plus haut
    const prixConseille = lirePrix(/prdDtl__priceZone__suggested__price">\s*<strong>([^<]+)</.exec(html)?.[1]) ?? Math.max(...lues.map((v) => v.prix));

    return {
        nom,
        variantes: await ajouterStock(
            nom,
            lues.map((v) => ({ ...v, nom, prixConseille })),
        ),
    };
}

// Une carte de résultat = un coloris
function lireCartes(html: string): (Omit<Variante, "pointures"> & { genre: string })[] {
    const cartes: (Omit<Variante, "pointures"> & { genre: string })[] = [];
    for (const bloc of html.split(/<article id="maindiv(?=\d+")/).slice(1)) {
        const contenu = bloc.slice(0, bloc.indexOf('class="quickview"'));
        const id = Number(/^\d+/.exec(contenu)?.[0]);
        const href = /<a href="([^"]+)"/.exec(contenu)?.[1];
        const prix = lirePrix(/c-productCard__currentPrice[^>]*>([^<]+)</.exec(contenu)?.[1]);
        if (!id || !href || !prix) continue;
        const marque = /c-productCard__brandName">([^<]*)</.exec(contenu)?.[1] ?? "";
        const modele = /c-productCard__productName">([^<]*)</.exec(contenu)?.[1] ?? "";
        cartes.push({
            id,
            nom: decoderEntites(`${marque} ${modele}`),
            url: new URL(decoderEntites(href), BASE).href,
            prix,
            // Pas de prix barré : le coloris est au prix conseillé
            prixConseille: lirePrix(/c-productCard__suggestedPrice[^>]*>([^<]+)</.exec(contenu)?.[1]) ?? prix,
            image: /<img[^>]+src="([^"]+)"/.exec(contenu)?.[1],
            genre: /c-productCard__gender--(\w+)/.exec(contenu)?.[1] ?? "",
        });
    }
    return cartes;
}

async function lireRecherche(url: string, genre: Genre): Promise<Suivi> {
    const adresse = new URL(url);
    const requete = adresse.searchParams.get("q")?.trim();
    if (!requete) throw new Error(`Recherche sans mots-clés : ${url}`);
    adresse.searchParams.delete("page");

    const cartes: ReturnType<typeof lireCartes> = [];
    for (let page = 1; page <= PAGES_MAX; page++) {
        // La page 1 se demande sans paramètre : "page=1" renvoie une page vide
        if (page > 1) {
            adresse.searchParams.set("page", String(page));
            await attendre(PAUSE_ENTRE_PAGES_MS);
        }
        const html = await telecharger(adresse.href);
        const trouvees = lireCartes(html);
        cartes.push(...trouvees);

        const total = Number(/data-total-products="(\d+)"/.exec(html)?.[1] ?? 0);
        if (trouvees.length === 0 || cartes.length >= total) break;
    }

    // La recherche d'i-Run ramène aussi des modèles voisins : on garde ceux qui contiennent tous les mots cherchés
    const voulus = mots(requete);
    const exclu = genre === "homme" ? "female" : genre === "femme" ? "male" : undefined;
    const vus = new Set<number>();
    const retenues = cartes.filter((c) => {
        if (vus.has(c.id) || c.genre === exclu) return false;
        vus.add(c.id);
        const nom = new Set(mots(c.nom));
        return voulus.every((m) => nom.has(m));
    });

    const variantes =
        retenues.length > 0
            ? await ajouterStock(
                  requete,
                  retenues.map(({ genre: _, ...v }) => v),
              )
            : [];
    return { nom: requete, variantes };
}

export function estRecherche(url: string): boolean {
    return new URL(url).pathname === "/recherche.html";
}

export function lireSuivi(url: string, genre: Genre): Promise<Suivi> {
    return estRecherche(url) ? lireRecherche(url, genre) : lireFiche(url);
}
