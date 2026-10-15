import { setTimeout as attendre } from "node:timers/promises";
import { euros, pointuresUtiles, prixLesPlusBas } from "./analyse.ts";
import { enregistrer, enregistrerReleve, prixNotifie, releves } from "./base.ts";
import { chargerModeles, config, type Modele } from "./config.ts";
import { envoyer, type Embed, type Fichier } from "./discord.ts";
import { dessinerGraphique } from "./graphique.ts";
import { lireSuivi, type Suivi } from "./irun.ts";

// Pause entre deux modèles pour ne pas enchaîner les requêtes
const PAUSE_ENTRE_MODELES_MS = 5_000;
// Alerte Discord quand un modèle échoue autant de fois d'affilée
const ECHECS_AVANT_ALERTE = 3;

const echecs = new Map<string, number>();

function journal(message: string): void {
    console.log(`[${new Date().toISOString()}] ${message}`);
}

// Renvoie les alertes à envoyer et de quoi enregistrer l'état, à n'appliquer qu'une fois Discord prévenu
function analyser(modele: Modele, suivi: Suivi): { embeds: Embed[]; valider: () => void } {
    const embeds: Embed[] = [];
    const enregistrements: (() => void)[] = [];

    for (const variante of suivi.variantes) {
        const remise = Math.round((1 - variante.prix / variante.prixConseille) * 100);
        const pointures = pointuresUtiles(modele, variante.pointures);
        const bonPrix =
            (modele.remiseMin !== undefined && remise >= modele.remiseMin) ||
            (modele.prixMax !== undefined && variante.prix <= modele.prixMax);
        const eligible = bonPrix && pointures.length > 0;

        const dejaNotifie = prixNotifie(variante.id);
        let notifie: number | null = null;
        if (eligible) {
            // On ne reprévient que si le prix baisse encore
            notifie = dejaNotifie === null ? variante.prix : Math.min(dejaNotifie, variante.prix);
            if (dejaNotifie === null || variante.prix < dejaNotifie) {
                const barre = variante.prix < variante.prixConseille ? ` au lieu de ${euros(variante.prixConseille)} (-${remise} %)` : "";
                embeds.push({
                    title: variante.nom,
                    url: variante.url,
                    description: `**${euros(variante.prix)}**${barre}`,
                    color: 0x16a34a,
                    thumbnail: variante.image ? { url: variante.image } : undefined,
                    fields: [{ name: "Pointures en stock", value: pointures.join(", ").slice(0, 1024) }],
                });
            }
        }
        enregistrements.push(() => enregistrer(variante.id, variante.nom, variante.url, variante.prix, notifie));

        if (bonPrix) journal(`  ${variante.nom} ${variante.id} ${euros(variante.prix)} (-${remise} %) ${eligible ? "PROMO" : "pointure absente"}`);
    }
    return { embeds, valider: () => enregistrements.forEach((e) => e()) };
}

// Le graphique est un bonus : en cas d'échec, l'alerte part sans lui
function graphiqueJoint(modele: Modele, nom: string): Fichier | undefined {
    try {
        return { nom: "prix.png", donnees: dessinerGraphique(nom, releves(modele.url), modele.prixMax) };
    } catch (e) {
        journal(`  Graphique indisponible : ${e instanceof Error ? e.message : String(e)}`);
        return undefined;
    }
}

async function verifier(modele: Modele): Promise<void> {
    try {
        const suivi = await lireSuivi(modele.url, modele.genre);
        const { prixMin, prixMinPointure, prixConseille } = prixLesPlusBas(modele, suivi);
        const resume = prixMinPointure === null ? "rien dans ta pointure" : `${euros(prixMinPointure)} au mieux dans ta pointure`;
        journal(`${suivi.nom} : ${suivi.variantes.length} coloris, ${resume}`);
        echecs.delete(modele.url);

        if (prixMin !== null && prixConseille !== null) enregistrerReleve(modele.url, prixMin, prixMinPointure, prixConseille);

        const { embeds, valider } = analyser(modele, suivi);
        if (embeds.length > 0) {
            const coloris = embeds.length > 1 ? `${embeds.length} coloris` : "1 coloris";
            const graphique = graphiqueJoint(modele, suivi.nom);
            if (graphique) embeds.unshift({ title: `${suivi.nom} : évolution du prix`, url: modele.url, image: { url: `attachment://${graphique.nom}` } });
            await envoyer(`Promo i-Run : ${suivi.nom} (${coloris})`, embeds, graphique);
            journal(`  Discord prévenu pour ${coloris}`);
        }
        valider();
    } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        const nombre = (echecs.get(modele.url) ?? 0) + 1;
        echecs.set(modele.url, nombre);
        journal(`Erreur (${nombre}) : ${message}`);
        if (nombre === ECHECS_AVANT_ALERTE) {
            await envoyer(`PromoIrun : ${modele.url} échoue depuis ${nombre} vérifications.\n${message}`).catch((err: unknown) =>
                journal(`Discord injoignable : ${err instanceof Error ? err.message : err}`),
            );
        }
    }
}

async function passage(): Promise<void> {
    const modeles = await chargerModeles();
    journal(`Vérification de ${modeles.length} modèle(s)`);
    for (const [i, modele] of modeles.entries()) {
        if (i > 0) await attendre(PAUSE_ENTRE_MODELES_MS);
        await verifier(modele);
    }
}

async function main(): Promise<void> {
    if (process.argv.includes("--une-fois")) return passage();

    const arret = new AbortController();
    for (const s of ["SIGINT", "SIGTERM"] as const) process.once(s, () => arret.abort());

    while (!arret.signal.aborted) {
        try {
            await passage();
        } catch (e) {
            journal(`Erreur : ${e instanceof Error ? e.message : String(e)}`);
        }
        // Un peu d'aléa pour ne pas interroger le site à heure fixe
        const delai = config.intervalleMs * (0.9 + Math.random() * 0.2);
        journal(`Prochaine vérification dans ${Math.round(delai / 60_000)} min`);
        await attendre(delai, undefined, { signal: arret.signal }).catch(() => {});
    }
    journal("Arrêt.");
}

main().catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
});
