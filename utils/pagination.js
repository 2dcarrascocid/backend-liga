import crypto from "crypto";

const SECRET = process.env.API_KEY; // usa la misma API_KEY de serverless

export function encodeNext(offset, limit) {
    const payload = JSON.stringify({ offset, limit });
    const base = Buffer.from(payload).toString("base64");

    const signature = crypto
        .createHmac("sha256", SECRET)
        .update(base)
        .digest("hex");

    return `${base}.${signature}`;
}

export function decodeNext(next) {
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
        return JSON.parse(json);
    } catch {
        return null;
    }
}
