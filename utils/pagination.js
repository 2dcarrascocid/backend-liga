import crypto from "crypto";

const SECRET = process.env.API_KEY || "default_secret"; // usa la misma API_KEY de serverless

export function encodeNext(offset, limit, extra = {}) {
    const payload = JSON.stringify({ offset, limit, ...extra });
    const base = Buffer.from(payload).toString("base64");

    const signature = crypto
        .createHmac("sha256", SECRET)
        .update(base)
        .digest("hex");

    return `${base}.${signature}`;
}

export function decodeNext(next, expectedContext = {}) {
    try {
        const [base, signature] = next.split(".");

        const expectedSignature = crypto
            .createHmac("sha256", SECRET)
            .update(base)
            .digest("hex");

        if (signature !== expectedSignature) {
            return null;
        }

        const json = Buffer.from(base, "base64").toString();
        const payload = JSON.parse(json);

        // Validar contexto (ej: orgId, clubId) si se proporcionó en la llamada a decodeNext
        if (expectedContext && typeof expectedContext === "object") {
            for (const [key, value] of Object.entries(expectedContext)) {
                if (value !== undefined && payload[key] !== undefined && payload[key] !== value) {
                    return null;
                }
            }
        }

        return payload;
    } catch {
        return null;
    }
}

