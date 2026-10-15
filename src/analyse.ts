import type { Modele } from "./config.ts";
import type { Suivi } from "./irun.ts";

function normaliserPointure(pointure: string): string {
    return pointure.trim().replace(/[\s,.]+/g, ".");
}

export function euros(prix: number): string {
    return `${prix.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} €`;
}

export function pointuresUtiles(modele: Modele, disponibles: string[]): string[] {
    if (modele.pointures.length === 0) return disponibles;
    const voulues = new Set(modele.pointures.map(normaliserPointure));
    return disponibles.filter((p) => voulues.has(normaliserPointure(p)));
}

// Prix le plus bas tous coloris confondus, et parmi les coloris dispo dans les pointures voulues
export function prixLesPlusBas(modele: Modele, suivi: Suivi): { prixMin: number | null; prixMinPointure: number | null; prixConseille: number | null } {
    const min = (prix: number[]) => (prix.length > 0 ? Math.min(...prix) : null);
    const enStock = suivi.variantes.filter((v) => pointuresUtiles(modele, v.pointures).length > 0);
    return {
        prixMin: min(suivi.variantes.map((v) => v.prix)),
        prixMinPointure: min(enStock.map((v) => v.prix)),
        prixConseille: suivi.variantes.length > 0 ? Math.max(...suivi.variantes.map((v) => v.prixConseille)) : null,
    };
}
