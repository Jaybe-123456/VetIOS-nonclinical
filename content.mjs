import { GOVERNANCE } from './policy.mjs';

const navigation = '<nav aria-label="Main navigation"><a href="/docs/">Public docs</a><a href="/demo/">Synthetic demo</a><a href="/boundary/">Release boundary</a></nav>';
export function page(title, body, script = false) {
    return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
        + '<meta name="description" content="VetIOS: evidence-aware intelligence, execution and verification infrastructure. Public documentation and fixed synthetic demonstrations only.">'
        + `<title>${title} · VetIOS</title><link rel="stylesheet" href="/assets/site.css">`
        + (script ? '<script src="/assets/demo.js" defer></script>' : '') + '</head><body>'
        + '<a class="skip" href="#main">Skip to content</a><header><div class="shell bar"><a class="brand" href="/" aria-label="VetIOS home"><i aria-hidden="true"></i>VetIOS</a>' + navigation + '</div></header>'
        + `<main id="main" class="shell">${body}</main>`
        + '<footer><div class="shell footer-row"><a class="brand" href="/">VetIOS</a><p>Evidence-aware intelligence, execution and verification.<br>Non-clinical site. No patient-data submission or clinical API access.</p><a href="/boundary/">Privacy &amp; release limits</a></div></footer></body></html>\n';
}
export const pages = {
    'index.html': page('An evidence trail for consequential work', `
<section class="hero"><div><p class="eyebrow"><span class="dot"></span>Evidence · execution · verification</p>
<h1>Intelligence deserves an evidence trail.</h1>
<p class="lead">VetIOS is building a control plane that connects a decision to its evidence, actions, observed outcomes and verification.</p>
<p>Veterinary workflows are the first proving ground. The ambition extends to biological systems; clinical validation and broader transfer must be earned through observed evidence.</p>
<div class="actions"><a class="button" href="/demo/">Explore a synthetic trace ↗</a><a class="button secondary" href="/docs/">Read the architecture</a></div>
<p class="stamp">PUBLIC DOCUMENTATION + FIXED DEMONSTRATIONS</p></div>
<div class="trace" aria-label="A fixed synthetic evidence trace"><div class="trace-top"><span class="label">Intelligence transaction</span><span class="badge">SYNTHETIC</span></div>
<div class="trace-row"><b>01</b><div><strong>Compile the state</strong><p>Preserve observations, provenance and missing information.</p></div></div>
<div class="trace-row"><b>02</b><div><strong>Make the claim explicit</strong><p>Connect each proposed step to its prerequisites.</p></div></div>
<div class="trace-row"><b>03</b><div><strong>Link the observed outcome</strong><p>Later evidence can revise an earlier conclusion.</p></div></div>
<div class="trace-row"><b>04</b><div><strong>Verify before learning</strong><p>Recorded activity does not establish truth or approval.</p></div></div>
<p class="trace-foot">A trace, not a confidence claim.</p></div></section>
<div class="strip"><span>Models are replaceable</span><span>Provenance stays visible</span><span>Uncertainty stays explicit</span></div>
<section class="section"><span class="label">The infrastructure thesis</span><h2>Follow the decision all the way to reality.</h2>
<div class="grid"><article class="card"><span class="label">01 / Evidence</span><h3>Keep the source attached.</h3><p>Typed state and evidence references make contradictions and missing observations inspectable.</p></article>
<article class="card"><span class="label">02 / Execution</span><h3>Make prerequisites executable.</h3><p>Policies constrain which tools, workflows and human roles may perform a consequential action.</p></article>
<article class="card"><span class="label">03 / Outcomes</span><h3>Let future evidence disagree.</h3><p>An outcome receipt links the observed result to the earlier decision graph. Eligible evidence can support future evaluation.</p></article></div></section>
<section class="band"><div><span class="label">What you can explore today</span><h2>A transparent, bounded demonstration.</h2><p>Step through a prescribed laboratory-control trace. There is no model call, patient input, external action or learning workflow.</p></div><a class="button" href="/demo/">Open the demonstration</a></section>
<section class="section"><span class="tag">Clinical production: blocked</span><p class="lead">Public product communication and clinical authorization are separate release tracks.</p><a href="/boundary/">Inspect the deployment boundary and governance state →</a></section>`),
    'docs/index.html': page('Public architecture', `<section class="page prose"><span class="label">Public documentation / version 1</span><h1>From an objective to a verifiable transaction.</h1>
<p class="lead">The unit of work is a versioned evidence and execution graph. A fluent response or a model confidence score is not an observed outcome.</p>
<h2>State and plans</h2><p>Preserve original observations, source permissions, timestamps, contradictions and unknowns. Translate an objective into explicit claims, missing evidence, prerequisites and bounded workflow steps.</p>
<h2>Policy and verification</h2><p>Models and deterministic tools are replaceable resources. Routing must respect accuracy, uncertainty, cost, latency, sovereignty and verification requirements. Missing prerequisites require abstention or escalation.</p>
<h2>Outcome receipts</h2><p>Record what was proposed, what actually happened and which later observation confirms or revises the earlier graph. Preserve versions, evidence provenance, overrides and permission boundaries. A hash establishes byte integrity; it does not appoint a reviewer or establish clinical truth.</p>
<h2>Evaluation and learning</h2><p>Outcome-confirmed cases can become evaluation infrastructure only under admissibility, consent and governance controls. Neither synthetic fixtures nor a saved observation authorize calibration, model promotion or federation.</p>
<div class="notice">This is a public architectural description. It does not assert clinical validation, operational clinical availability, an active federation or a commissioned release runner.</div>
<h2>Current public surface</h2><p>This independent site serves static files and prescribed demonstrations. It has no clinical API, patient database, user accounts, ingestion, autonomous decision execution or production learning connection.</p><a class="button" href="/boundary/">Review the exact boundary</a></section>`),
    'demo/index.html': page('Synthetic evidence trace', `<section class="page"><span class="label">Fixed demonstration / laboratory control</span><h1>A later observation changes the graph.</h1>
<p class="lead">Explore three authored states of one synthetic laboratory-control run. Every value is predefined. No diagnosis, treatment recommendation, model execution or patient submission occurs.</p>
<div class="notice">Synthetic demonstration only. Selecting a version changes this local display; it performs no clinical action, network request or learning update.</div>
<div class="switches" role="group" aria-label="Synthetic trace versions"><button type="button" data-state="0" aria-pressed="true">1 · Missing observation</button><button type="button" data-state="1" aria-pressed="false">2 · Contradiction</button><button type="button" data-state="2" aria-pressed="false">3 · Follow-up linked</button></div>
<div class="demo-grid"><section aria-live="polite" aria-atomic="true"><span class="label" data-value="status">OBSERVATION PENDING</span><h2>Trace version <span data-value="version">1</span></h2><dl>
${['objective','evidence','action','outcome','verification','learning'].map(key => `<div class="data-row"><dt>${key}</dt><dd data-value="${key}">Demonstration requires local JavaScript to display the prescribed state.</dd></div>`).join('')}
</dl></section><section class="receipt"><span class="label">Demonstration record / no signature</span><pre data-json aria-label="Synthetic record">No live record is loaded.</pre></section></div><p class="small">Real-patient inference, clinical release and outcome learning remain disabled in this deployment. These controls do not depend on this notice.</p></section>`, true),
    'boundary/index.html': page('Release and privacy boundary', `<section class="page"><span class="label">Two release tracks</span><h1>Public infrastructure. Clinical gates intact.</h1>
<p class="lead">This site is independently isolated from the governed clinical application. Its deployment cannot accept patient data, infer a diagnosis, update an outcome model or join a live federation.</p>
<div class="status-grid">${Object.entries(GOVERNANCE).map(([key,value]) => `<div class="status"><span>${key.replaceAll('_',' ')}</span><strong>${value}</strong></div>`).join('')}</div>
<table class="rule-table"><thead><tr><th>INCLUDED</th><th>EXCLUDED FROM THIS DEPLOYMENT</th></tr></thead><tbody><tr><td>Static public website and architecture docs</td><td>Clinical inference APIs, patient records and uploads</td></tr><tr><td>Fixed synthetic laboratory-control traces</td><td>Outcome-learning jobs, model promotion and federation</td></tr><tr><td>Non-clinical publication, monitoring and rollback</td><td>Clinical credentials, tenant administration and governed runner access</td></tr></tbody></table>
<div class="prose"><h2>Privacy</h2><p>This candidate provides no accounts, forms, cookies, local storage, analytics integrations or patient-data input. Hosting providers necessarily process network requests and their operational metadata. Final public privacy/contact information, retention settings and notification ownership must be reviewed before publication.</p>
<h2>Approval means one scope</h2><p>Human authorization to publish these static materials grants no independent reviewer appointment or clinical approval. Existing clinical production gates stay enforced. Do not use this site to submit clinical or other sensitive data.</p>
<h2>Evidence limits</h2><p>Demonstration traces and engineering tests establish software behavior only. Clinical authority, commissioning and validated clinical performance are not established.</p></div></section>`),
};
