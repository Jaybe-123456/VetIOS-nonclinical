// Metadata intake, not an attestation that a provider event actually occurred.
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { canonical, shaPattern, PUBLIC_OPERATOR_NAME } from './policy.mjs';
import { sha256 } from './build.mjs';

export const fields = (value, keys) => assert.deepEqual(Object.keys(value).sort(), [...keys].sort(), 'closed record required');
export async function privateBytes(file) {
    file = path.resolve(file);
    assert.equal(await fs.realpath(file), file, 'private evidence symlink rejected');
    const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
        const before = await handle.stat();
        assert.ok(before.isFile() && before.size > 0 && before.size <= 48 * 1024 && (before.mode & 0o077) === 0, 'bounded private regular evidence required');
        const bytes = Buffer.alloc(before.size + 1);
        const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
        const after = await handle.stat(), linked = await fs.lstat(file);
        assert.equal(await fs.realpath(file), file);
        for (const key of ['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs', 'mode']) {
            assert.equal(after[key], before[key], 'evidence changed during intake');
            assert.equal(linked[key], before[key], 'evidence path replaced');
        }
        assert.equal(bytesRead, before.size); return bytes.subarray(0, bytesRead);
    } finally { await handle.close(); }
}
const label = value => assert.ok(typeof value === 'string' && /^[\w @.,:+/()-]{3,200}$/.test(value), 'short metadata label required');
const digest = value => assert.match(value, shaPattern);
const instant = value => { assert.match(value, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/); const time = Date.parse(value); assert.ok(Number.isFinite(time)); return time; };

export function inspectCommissioning(raw, { now = Date.now() } = {}) {
    assert.ok(Buffer.byteLength(raw) > 0 && Buffer.byteLength(raw) <= 48 * 1024);
    const p = JSON.parse(raw);
    fields(p, ['schema', 'scope', 'operator', 'contact', 'provider', 'response_hours', 'retention_policy', 'recorded_at', 'expires_at', 'mail', 'alert', 'reviews']);
    assert.equal(p.schema, 'vetios-nonclinical-commissioning-v1');
    assert.equal(p.scope, 'VERCEL_STATIC_ONLY'); assert.equal(p.operator, PUBLIC_OPERATOR_NAME);
    assert.equal(p.contact, 'platform@vetios.tech'); label(p.provider); label(p.response_hours); label(p.retention_policy);
    const recorded = instant(p.recorded_at), expires = instant(p.expires_at);
    assert.ok(recorded <= now && expires > now && expires - recorded <= 30 * 86400000, 'commissioning must be current and time bounded');
    fields(p.mail, ['inbound_sent_at', 'inbound_delivered_at', 'reply_sent_at', 'reply_delivered_at', 'message_ids_sha256', 'provider_record_sha256', 'operator_acknowledged_at']);
    const mailTimes = ['inbound_sent_at', 'inbound_delivered_at', 'reply_sent_at', 'reply_delivered_at', 'operator_acknowledged_at'].map(k => instant(p.mail[k]));
    for (let i = 0; i < mailTimes.length; i++) assert.ok(mailTimes[i] <= recorded && mailTimes[i] >= recorded - 30 * 86400000 && (!i || mailTimes[i] >= mailTimes[i - 1]), 'actual ordered delivery and acknowledgement times required');
    digest(p.mail.message_ids_sha256); digest(p.mail.provider_record_sha256);
    fields(p.alert, ['triggered_by', 'triggered_at', 'delivered_at', 'acknowledged_by', 'acknowledged_at', 'event_id_sha256', 'provider_record_sha256']);
    label(p.alert.triggered_by); assert.notEqual(p.alert.triggered_by.toLowerCase(), p.operator.toLowerCase(), 'independent alert trigger required');
    assert.equal(p.alert.acknowledged_by, p.operator);
    const trigger = instant(p.alert.triggered_at), delivery = instant(p.alert.delivered_at), ack = instant(p.alert.acknowledged_at);
    assert.ok(trigger >= recorded - 30 * 86400000 && trigger <= delivery && delivery <= ack && ack <= recorded);
    digest(p.alert.event_id_sha256); digest(p.alert.provider_record_sha256);
    fields(p.reviews, ['operator_acceptance', 'identity_and_privacy', 'provider_access_and_retention', 'security', 'suspension_drill']);
    for (const hash of Object.values(p.reviews)) digest(hash);
    return { schema: 'vetios-nonclinical-intake-v1', packet_sha256: sha256(raw), status: 'IMPORTED_UNAPPROVED', operational_truth_verified: false, production_authorized: false };
}

export function approvedCommissioning(raw, pin, options) {
    assert.match(pin ?? '', shaPattern, 'independently reviewed commissioning digest required');
    const receipt = inspectCommissioning(raw, options);
    assert.equal(receipt.packet_sha256, pin, 'commissioning packet differs from protected approval pin');
    return receipt;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    try {
    assert.equal(process.argv.length, 4, 'usage: node commissioning-intake.mjs PRIVATE_PACKET NEW_PRIVATE_RECEIPT');
    const receipt = inspectCommissioning(await privateBytes(process.argv[2]));
    await fs.writeFile(process.argv[3], canonical(receipt) + '\n', { flag: 'wx', mode: 0o600 });
    process.stdout.write('Metadata imported unapproved; an independent human must verify the underlying private records.\n');
    } catch {
        process.stderr.write('Private evidence intake rejected. Check the closed schema, actual record times, digest references and private regular-file permissions.\n');
        process.exitCode = 1;
    }
}
