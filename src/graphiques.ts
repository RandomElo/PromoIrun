import { setTimeout as attendre } from "node:timers/promises";
import { euros, prixLesPlusBas } from "./analyse.ts";
import { releves, type Releve } from "./base.ts";
import { chargerModeles, type Modele } from "./config.ts";
import { envoyer } from "./discord.ts";
import { dessinerGraphique } from "./graphique.ts";
import { lireSuivi, type Suivi } from "./irun.ts";

// Envoie sur Discord le graphique de prix de chaque modèle suivi.
// --simulation : 90 jours d'historique fictif (rien n'est écrit en base), pour vérifier le rendu.
const simulation = process.argv.includes("--simulation");

// Historique fictif qui finit sur les prix actuels : une promo marquée, des remontées et des ruptures de pointure
function simuler(modele: Modele, suivi: Suivi): Releve[] {
    const actuel = prixLesPlusBas(modele, suivi);
    const conseille = actuel.prixConseille ?? 150;
    let graine = [...modele.url].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 2147483647, 7) || 1;
    const hasard = () => (graine = (graine * 16807) % 2147483647) / 2147483647;

    const points: Releve[] = [];
    let prix = conseille;
    for (let j = 89; j >= 0; j--) {
        const jour = new Date(Date.now() - j * 86_400_000).toISOString().slice(0, 10);
        if (j === 0) {
            points.push({ jour, prixMin: actuel.prixMin ?? prix, prixMinPointure: actuel.prixMinPointure, prixConseille: conseille });
            continue;
        }
        const cible = j < 55 && j > 40 ? 0.6 : j < 25 ? 0.82 : 1;
        prix = Math.round(Math.min(conseille, Math.max(conseille * 0.45, prix + (conseille * cible - prix) * 0.3 + (hasard() - 0.5) * 8)));
        const rupture = hasard() < 0.12;
        points.push({ jour, prixMin: prix - Math.round(hasard() * 10), prixMinPointure: rupture ? null : prix, prixConseille: conseille });
    }
    return points;
}

const modeles = await chargerModeles();
for (const [i, modele] of modeles.entries()) {
    if (i > 0) await attendre(3_000);
    const suivi = await lireSuivi(modele.url, modele.genre);
    const points = simulation ? simuler(modele, suivi) : releves(modele.url);
    if (points.length === 0) {
        console.log(`${suivi.nom} : aucun relevé pour l'instant`);
        continue;
    }

    const image = dessinerGraphique(suivi.nom, points, modele.prixMax);
    const { prixMinPointure } = prixLesPlusBas(modele, suivi);
    const actuel = prixMinPointure === null ? "rien en stock dans ta pointure" : `${euros(prixMinPointure)} au mieux dans ta pointure`;
    const seuil = modele.prixMax === undefined ? "" : `, seuil ${euros(modele.prixMax)}`;
    await envoyer(
        `${simulation ? "[TEST, historique simulé] " : ""}${suivi.nom} : ${actuel}${seuil}`,
        [{ title: suivi.nom, url: modele.url, image: { url: "attachment://prix.png" } }],
        { nom: "prix.png", donnees: image },
    );
    console.log(`${suivi.nom} : graphique envoyé (${points.length} jours, ${suivi.variantes.length} coloris suivis)`);
}
