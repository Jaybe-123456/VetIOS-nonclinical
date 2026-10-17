'use strict';
// Fixed authored states only. There is no input parser, inference, persistence or transport.
const states = [
    { version: 1, status: 'OBSERVATION PENDING', objective: 'Reconcile a synthetic laboratory control run.',
        evidence: 'Control A is within the authored range. Control B has no returned result.',
        action: 'Wait for the missing observation. No sample disposition is authorized.',
        outcome: 'Unobserved', verification: 'Insufficient evidence', learning: 'Disabled' },
    { version: 2, status: 'CONTRADICTION RECORDED', objective: 'Reconcile a synthetic laboratory control run.',
        evidence: 'Control B returns outside the authored range. The earlier completion claim is revised.',
        action: 'Retain the contradiction and request human investigation. No clinical action is proposed.',
        outcome: 'Synthetic control discrepancy', verification: 'Abstain; investigation required', learning: 'Disabled' },
    { version: 3, status: 'SYNTHETIC TRACE COMPLETE', objective: 'Reconcile a synthetic laboratory control run.',
        evidence: 'A prescribed repeat observation identifies an authored control preparation error.',
        action: 'Link the supplied follow-up to the earlier graph. Preserve versions 1 and 2.',
        outcome: 'Authored explanation recorded', verification: 'Demonstration linkage only; no validation', learning: 'Disabled' },
];
const buttons = [...document.querySelectorAll('[data-state]')];
function render(index) {
    const state = states[index]; if (!state) return;
    for (const [key, value] of Object.entries(state)) {
        const target = document.querySelector(`[data-value="${key}"]`); if (target) target.textContent = String(value);
    }
    for (const button of buttons) button.setAttribute('aria-pressed', String(Number(button.dataset.state) === index));
    document.querySelector('[data-json]').textContent = JSON.stringify({ schema: 'vetios-synthetic-trace-v1',
        fixture_only: true, patient_data: false, external_actions: 0, clinical_authority: 'NOT_ESTABLISHED', ...state }, null, 2);
}
for (const button of buttons) button.addEventListener('click', () => render(Number(button.dataset.state)));
if (buttons.length) render(0);
