import { readFile } from "node:fs/promises";
import type { Genre } from "./irun.ts";

function lire(nom: string): string | undefined {
    const valeur = process.env[nom]?.trim();
    return valeur ? valeur : undefined;
}

const webhookDiscord = lire("DISCORD_WEBHOOK_URL");
if (!webhookDiscord) {
    throw new Error("Variable DISCORD_WEBHOOK_URL manquante : copie .env.example en .env et renseigne-la.");
}

const intervalle = Number(lire("INTERVALLE_MINUTES") ?? 60);
if (!Number.isFinite(intervalle) || intervalle < 5) {
    throw new Error("INTERVALLE_MINUTES doit être un nombre supérieur ou égal à 5.");
}

export const config = {
    webhookDiscord,
    intervalleMs: intervalle * 60_000,
    fichierModeles: lire("MODELES_FICHIER") ?? "config/modeles.json",
    fichierBase: lire("BASE_FICHIER") ?? "data/promo-irun.sqlite",
};

export interface Modele {
    url: string;
    // Au moins un des deux critères est défini
    remiseMin?: number;
    prixMax?: number;
    // Vide : n'importe quelle pointure en stock suffit
    pointures: string[];
    // Filtre des résultats de recherche (sans effet sur une fiche produit)
    genre: Genre;
}

const GENRES: Genre[] = ["homme", "femme", "tous"];
const URL_VALIDE = /^https:\/\/www\.i-run\.fr\/(.+_fiche_\d+\.html|recherche\.html\?(.*&)?q=[^&]+)/;

interface FichierModeles {
    pointures?: string[];
    genre?: Genre;
    remiseMin?: number;
    prixMax?: number;
    modeles?: (Partial<Omit<Modele, "url">> & { url?: string })[];
}

// Relu à chaque passage : on peut modifier la liste sans redémarrer le conteneur
export async function chargerModeles(): Promise<Modele[]> {
    const brut = JSON.parse(await readFile(config.fichierModeles, "utf8")) as FichierModeles;

    return (brut.modeles ?? []).map((m, i) => {
        if (!m.url || !URL_VALIDE.test(m.url)) {
            throw new Error(`Modèle n°${i + 1} : ni une fiche produit ni une recherche i-Run (${m.url ?? "URL absente"}).`);
        }
        const genre = m.genre ?? brut.genre ?? "tous";
        if (!GENRES.includes(genre)) throw new Error(`Modèle n°${i + 1} : genre "${genre}" inconnu (${GENRES.join(", ")}).`);
        const prixMax = m.prixMax ?? brut.prixMax;
        return {
            url: m.url,
            // Avec un prix plafond, la remise globale ne s'applique que si elle est donnée explicitement au modèle
            remiseMin: m.remiseMin ?? (prixMax === undefined ? (brut.remiseMin ?? 25) : undefined),
            prixMax,
            pointures: m.pointures ?? brut.pointures ?? [],
            genre,
        };
    });
}
