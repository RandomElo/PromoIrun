import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { config } from "./config.ts";

mkdirSync(dirname(config.fichierBase), { recursive: true });
const base = new DatabaseSync(config.fichierBase);

base.exec(`
    CREATE TABLE IF NOT EXISTS variantes (
        id INTEGER PRIMARY KEY,
        produit TEXT NOT NULL,
        url TEXT NOT NULL,
        prix REAL NOT NULL,
        prix_notifie REAL,
        vu_le TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS releves (
        suivi TEXT NOT NULL,
        date TEXT NOT NULL,
        prix_min REAL NOT NULL,
        prix_min_pointure REAL,
        prix_conseille REAL NOT NULL
    );
    CREATE INDEX IF NOT EXISTS releves_suivi ON releves (suivi, date);
    CREATE TABLE IF NOT EXISTS historique (
        variante_id INTEGER NOT NULL,
        prix REAL NOT NULL,
        date TEXT NOT NULL
    );
`);

const lireVariante = base.prepare("SELECT prix, prix_notifie FROM variantes WHERE id = ?");
const ecrireVariante = base.prepare(`
    INSERT INTO variantes (id, produit, url, prix, prix_notifie, vu_le) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (id) DO UPDATE SET
        produit = excluded.produit, url = excluded.url, prix = excluded.prix,
        prix_notifie = excluded.prix_notifie, vu_le = excluded.vu_le
`);
const ajouterHistorique = base.prepare("INSERT INTO historique (variante_id, prix, date) VALUES (?, ?, ?)");

export function prixNotifie(id: number): number | null {
    const ligne = lireVariante.get(id) as { prix_notifie: number | null } | undefined;
    return ligne?.prix_notifie ?? null;
}

export function enregistrer(id: number, produit: string, url: string, prix: number, notifie: number | null): void {
    const maintenant = new Date().toISOString();
    const ancien = lireVariante.get(id) as { prix: number } | undefined;
    if (ancien?.prix !== prix) ajouterHistorique.run(id, prix, maintenant);
    ecrireVariante.run(id, produit, url, prix, notifie, maintenant);
}

export interface Releve {
    jour: string;
    prixMin: number;
    // Null quand aucun coloris n'est en stock dans les pointures voulues
    prixMinPointure: number | null;
    prixConseille: number;
}

const ajouterReleve = base.prepare(
    "INSERT INTO releves (suivi, date, prix_min, prix_min_pointure, prix_conseille) VALUES (?, ?, ?, ?, ?)",
);
const lireReleves = base.prepare(`
    SELECT date(date, 'localtime') AS jour, MIN(prix_min) AS prixMin,
        MIN(prix_min_pointure) AS prixMinPointure, MAX(prix_conseille) AS prixConseille
    FROM releves
    WHERE suivi = ? AND date >= ?
    GROUP BY jour ORDER BY jour
`);

// suivi : URL de la fiche ou de la recherche surveillée
export function enregistrerReleve(suivi: string, prixMin: number, prixMinPointure: number | null, prixConseille: number): void {
    ajouterReleve.run(suivi, new Date().toISOString(), prixMin, prixMinPointure, prixConseille);
}

// Un point par jour : le prix le plus bas relevé ce jour-là
export function releves(suivi: string, jours = 90): Releve[] {
    const depuis = new Date(Date.now() - jours * 86_400_000).toISOString();
    return lireReleves.all(suivi, depuis) as unknown as Releve[];
}
