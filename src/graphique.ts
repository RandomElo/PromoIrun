import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";
import * as echarts from "echarts";
import type { Releve } from "./base.ts";

// ECharts produit un SVG côté serveur, resvg le convertit en PNG : pas de navigateur, binaires dispo pour ARM
const LARGEUR = 1000;
const HAUTEUR = 520;
const ECHELLE = 2;

// Police embarquée : même rendu en local et sur le Raspberry, sans dépendre des polices du système
const POLICES = ["Inter-Regular.ttf", "Inter-SemiBold.ttf"].map((f) => fileURLToPath(new URL(`../assets/fonts/${f}`, import.meta.url)));

const THEME = {
    fond: "#111827",
    titre: "#f9fafb",
    texte: "#9ca3af",
    grille: "rgba(156, 163, 175, 0.12)",
    pointure: "#34d399",
    toutes: "#64748b",
    seuil: "#f87171",
};

function libelleJour(jour: string): string {
    const [, mois, j] = jour.split("-");
    return `${j}/${mois}`;
}

function euros(prix: number): string {
    return `${Math.round(prix)} €`;
}

// Bornes et pas « ronds » pour l'axe des prix, seuil toujours visible
function echelle(valeurs: number[]): { min: number; max: number; pas: number } {
    const bas = Math.min(...valeurs);
    const haut = Math.max(...valeurs);
    const pas = [5, 10, 20, 25, 50, 100].find((p) => (haut - bas) / p <= 5) ?? 100;
    return { min: Math.max(0, Math.floor(bas / pas) * pas - pas), max: Math.ceil(haut / pas) * pas + pas, pas };
}

export function dessinerGraphique(nom: string, points: Releve[], seuil?: number): Buffer {
    // Un seul relevé (premiers jours) : une ligne n'a pas de longueur, on affiche les points
    const seul = points.length === 1;
    const jours = points.map((p) => libelleJour(p.jour));
    const depuis = points.length > 0 ? libelleJour(points[0].jour) : "";
    const prix = points.flatMap((p) => [p.prixMin, p.prixMinPointure]).filter((v): v is number => v !== null);
    const axe = echelle(seuil === undefined ? prix : [...prix, seuil]);

    const graphique = echarts.init(null, null, { renderer: "svg", ssr: true, width: LARGEUR, height: HAUTEUR });
    graphique.setOption({
        animation: false,
        backgroundColor: THEME.fond,
        textStyle: { fontFamily: "Inter", color: THEME.texte },
        title: {
            text: nom,
            subtext: `Prix le plus bas chez i-Run depuis le ${depuis}`,
            left: 32,
            top: 24,
            textStyle: { color: THEME.titre, fontSize: 22, fontWeight: 600 },
            subtextStyle: { color: THEME.texte, fontSize: 14 },
            itemGap: 8,
        },
        legend: {
            right: 32,
            top: 30,
            itemWidth: 22,
            itemHeight: 3,
            itemGap: 20,
            icon: "rect",
            textStyle: { color: THEME.texte, fontSize: 13 },
        },
        grid: { left: 32, right: 72, top: 110, bottom: 40, containLabel: true },
        xAxis: {
            type: "category",
            data: jours,
            boundaryGap: seul,
            axisLine: { show: false },
            axisTick: { show: false },
            axisLabel: { color: THEME.texte, fontSize: 12, margin: 14, hideOverlap: true },
        },
        yAxis: {
            type: "value",
            min: axe.min,
            max: axe.max,
            interval: axe.pas,
            splitLine: { lineStyle: { color: THEME.grille } },
            axisLabel: { color: THEME.texte, fontSize: 12, formatter: "{value} €" },
        },
        series: [
            {
                name: "Dans ta pointure",
                type: "line",
                data: points.map((p) => p.prixMinPointure),
                connectNulls: false,
                // Lissage sans dépassement : la courbe ne passe jamais au-dessus ou en dessous des vrais prix
                smooth: 0.3,
                smoothMonotone: "x",
                symbol: "circle",
                symbolSize: 9,
                showSymbol: seul,
                lineStyle: { width: 3, color: THEME.pointure },
                itemStyle: { color: THEME.pointure },
                areaStyle: {
                    color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                        { offset: 0, color: "rgba(52, 211, 153, 0.16)" },
                        { offset: 1, color: "rgba(52, 211, 153, 0)" },
                    ]),
                },
                // Prix actuel affiché en bout de courbe
                endLabel: {
                    show: true,
                    formatter: (p: { value: number | null }) => (p.value === null ? "" : euros(p.value)),
                    color: THEME.pointure,
                    fontSize: 14,
                    fontWeight: 600,
                    distance: 10,
                },
                z: 3,
            },
            {
                name: "Toutes pointures",
                type: "line",
                data: points.map((p) => p.prixMin),
                smooth: 0.3,
                smoothMonotone: "x",
                symbol: "circle",
                symbolSize: 6,
                showSymbol: seul,
                lineStyle: { width: 1.5, color: THEME.toutes },
                itemStyle: { color: THEME.toutes },
                z: 2,
            },
            ...(seuil === undefined
                ? []
                : [
                      {
                          name: `Ton seuil (${euros(seuil)})`,
                          type: "line",
                          // Ligne de repère sur toute la largeur, même avec un seul relevé ; la série ne sert qu'à la légende
                          data: [],
                          lineStyle: { width: 1.5, type: [6, 5], color: THEME.seuil },
                          itemStyle: { color: THEME.seuil },
                          markLine: {
                              silent: true,
                              symbol: "none",
                              label: { show: false },
                              lineStyle: { width: 1.5, type: [6, 5], color: THEME.seuil },
                              data: [{ yAxis: seuil }],
                          },
                          z: 1,
                      },
                  ]),
        ],
    });

    const svg = graphique.renderToSVGString();
    graphique.dispose();

    const rendu = new Resvg(svg, {
        fitTo: { mode: "width", value: LARGEUR * ECHELLE },
        font: { fontFiles: POLICES, loadSystemFonts: false, defaultFontFamily: "Inter" },
    });
    return rendu.render().asPng();
}
