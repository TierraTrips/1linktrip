// Guest-facing wording is number-aware and gender-neutral (11/25: "Querido/a Ana y Luis: Estás invitado a…").
//  - the text-message invitation (INV_TXT / INV_TXT_MANY in app.js): one person → singular "you", 2+ → plural "you"
//  - the household / RSVP / invitation-picture strings in es/fr/pt/de/it carry no gendered forms
// (The email side is tests/invites.test.ts "number + gender".)   node tests/greeting-number.js
const fs = require('fs'); const path = require('path');
const ROOT = path.join(__dirname, '..'); const SRC = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
global.window = {}; eval(fs.readFileSync(path.join(ROOT, 'i18n.js'), 'utf8')); const I = window.EP_I18N;
const fails = []; const ok = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fails.push(m); };
const grab = (name) => { const m = SRC.match(new RegExp(`const ${name} = (\\{[\\s\\S]*?\\});\\n`)); return m ? m[1] : null; };
const INV_TXT = eval('(' + grab('INV_TXT') + ')'); const INV_TXT_MANY = eval('(' + grab('INV_TXT_MANY').replace('...INV_TXT', '...INV_TXT') + ')');
const fill = (s, n) => s.replace('{n}', n).replace('{t}', 'T').replace('{l}', 'L');
const WANT = { // [singular must match, plural must match, plural must not]
  es: [/aquí está tu invitación/, /aquí está su invitación/, /\btu\b/], pt: [/seu convite/, /convite de vocês/, /\bseu\b/],
  de: [/deine Einladung/, /eure Einladung/, /deine/], it: [/il tuo invito/, /il vostro invito/, /tuo/], fr: [/votre invitation/, /votre invitation/, /\bton\b|\bta\b/] };
for (const [l, [one, many, notMany]] of Object.entries(WANT)) {
  ok(one.test(fill(INV_TXT[l], 'Ana')), `${l} text, 1 person: ${fill(INV_TXT[l], 'Ana')}`);
  ok(many.test(fill(INV_TXT_MANY[l], 'Ana y Luis')) && !notMany.test(fill(INV_TXT_MANY[l], 'Ana y Luis')), `${l} text, 2 people: ${fill(INV_TXT_MANY[l], 'Ana y Luis')}`);
}
ok(/glPeople\(h\.id\)\.filter\(p => p\.added_by === 'host'\)\.length !== 1/.test(SRC) && /\(many \? INV_TXT_MANY : INV_TXT\)/.test(SRC), 'glInvText picks the plural for 0 or 2+ listed people');
const GUEST_KEYS = ['You’re invited', 'request the pleasure of your company', 'You’re invited to attend', 'Your guest', 'Add a guest', 'Add a guest for {n}', 'Guest’s name', 'Add your guest’s name.',
  'Guest {n}', 'Only the host sees your reply.', 'We’ve let the host know you can’t make it.', 'We’ve got you down as coming.', 'Note for the host (optional)', 'Replying for', 'Thanks, {n}.', 'Change replies', 'Send replies'];
const GENDERED = { es: /\binvitad[oa]s?\b|\bQuerid|o\/a\b|\banfitri|\bapuntad|\bListo\b|\bbienvenid/i, fr: /\binvitée?s?\b|\(e\)|\bl’hôte\b|\bcher\b|\bchère/i, pt: /\bconvidad[oa]s?\b|\(a\)|\banfitri/i,
  de: /\bder Gastgeber\b|\bdem Gastgeber\b|\bden Gastgeber\b|\/r\b|\bLiebe\b|\bIhr seid\b/, it: /\binvitat[oi]\b|\bCar[oi]\b|\bSiete\b/ };
for (const [l, re] of Object.entries(GENDERED)) {
  const bad = GUEST_KEYS.filter(k => re.test(I[l][k] || '')).map(k => `${k} → ${I[l][k]}`);
  ok(!bad.length && GUEST_KEYS.every(k => I[l][k]), `${l}: guest RSVP / household / picture strings neutral${bad.length ? ' — ' + bad.join(' | ') : ''}`);
}
console.log(fails.length ? `\n${fails.length} FAILED` : '\nall ok'); process.exit(fails.length ? 1 : 0);
