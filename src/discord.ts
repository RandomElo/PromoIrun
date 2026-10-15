import { setTimeout as attendre } from "node:timers/promises";
import { config } from "./config.ts";

export interface Embed {
    title: string;
    url?: string;
    description?: string;
    color?: number;
    thumbnail?: { url: string };
    image?: { url: string };
    fields?: { name: string; value: string; inline?: boolean }[];
}

// Image jointe au message, à référencer dans un embed par "attachment://<nom>"
export interface Fichier {
    nom: string;
    donnees: Buffer;
}

function corps(contenu: string | undefined, embeds: Embed[], fichier: Fichier | undefined): RequestInit {
    // Tous les messages notifient @everyone (alertes, graphiques, tests, erreurs)
    const payload = JSON.stringify({ content: contenu && `@everyone ${contenu}`, embeds, allowed_mentions: { parse: ["everyone"] } });
    if (!fichier) return { body: payload, headers: { "content-type": "application/json" } };

    const formulaire = new FormData();
    formulaire.append("payload_json", payload);
    formulaire.append("files[0]", new Blob([new Uint8Array(fichier.donnees)], { type: "image/png" }), fichier.nom);
    return { body: formulaire };
}

export async function envoyer(contenu: string, embeds: Embed[] = [], fichier?: Fichier): Promise<void> {
    // Discord limite un message à 10 embeds ; le fichier part avec le premier
    for (let i = 0; i === 0 || i < embeds.length; i += 10) {
        const premier = i === 0;

        for (let essai = 1; ; essai++) {
            const reponse = await fetch(config.webhookDiscord, {
                method: "POST",
                signal: AbortSignal.timeout(15_000),
                ...corps(premier ? contenu : undefined, embeds.slice(i, i + 10), premier ? fichier : undefined),
            });
            if (reponse.ok) break;
            if (reponse.status === 429 && essai < 3) {
                const { retry_after } = (await reponse.json().catch(() => ({}))) as { retry_after?: number };
                await attendre(Math.ceil((retry_after ?? 2) * 1000));
                continue;
            }
            throw new Error(`Discord a répondu ${reponse.status} : ${await reponse.text()}`);
        }
    }
}
