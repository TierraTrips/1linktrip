// shared by tests/ai-edit-live.ts (asks the model) and tests/ai-edit-check.mjs (applies + checks)
export const PAGE = {
  v: 2, type: 'Trip', title: 'Japan in spring', start: '2027-04-01', end: '2027-04-15', host: 'Dylan', tagline: '', description: 'Two weeks from Tokyo to Osaka.',
  venue: { name: 'Japan', address: 'Japan', lat: 36.2048, lon: 138.2529, city: '', country: 'Japan', cc: 'jp' },
  stops: [{ name: 'Tokyo', from: '2027-04-01', to: '2027-04-04', lat: 35.6764, lon: 139.65, city: 'Tokyo', country: 'Japan', cc: 'jp' }, { name: 'Kyoto', from: '2027-04-04', to: '2027-04-08', lat: 35.0116, lon: 135.7681, city: 'Kyoto', country: 'Japan', cc: 'jp' }, { name: 'Osaka', from: '2027-04-08', to: '2027-04-15', lat: 34.6937, lon: 135.5023, city: 'Osaka', country: 'Japan', cc: 'jp' }],
  schedule: [
    { date: '2027-04-01', time: '11:00', title: 'Flight LAX → HND', note: 'JL 61', kind: 'reservation' },
    { date: '2027-04-01', time: '18:00', title: 'Check in: Park Hotel Tokyo', note: 'Conf. PH-4417', kind: 'reservation' },
    { date: '2027-04-02', time: '', title: 'Tsukiji outer market', note: '', kind: 'activity' },
    { date: '2027-04-03', time: '', title: 'Day 3: Nikko day trip', note: '', kind: 'activity' },
    { date: '2027-04-04', time: '10:00', title: 'Shinkansen to Kyoto', note: 'Nozomi 215', kind: 'reservation' },
    { date: '2027-04-04', time: '15:00', title: 'Check in: Hotel Granvia Kyoto', note: 'Conf. GV-22', kind: 'reservation' },
    { date: '2027-04-08', time: '15:00', title: 'Check in: Cross Hotel Osaka', note: '', kind: 'reservation' },
    { date: '2027-04-15', time: '17:00', title: 'Flight KIX → LAX', note: 'JL 60', kind: 'reservation' },
  ],
  notes: [{ label: 'Money', text: 'Carry some cash.', url: '' }],
  custom: [{ id: 'h1', title: 'Hotels', text: 'Tokyo: Park Hotel Tokyo\nKyoto: Hotel Granvia Kyoto\nOsaka: Cross Hotel Osaka', label: '', url: '', img: '' },
    { id: 'd1', title: 'Dress code', text: 'Smart casual for the kaiseki dinner.', label: '', url: '', img: '' }],
  x: { Trip: { companions: 'Sam, Alex' } }, bring: 'Passport\nJR Pass voucher', off: {}, tools: {}, theme: { accent: '#1E7FA8', font: 'serif', mode: 'light' },
};
export const PROMPTS = [
  ['kyoto-hotel', 'remove the hotel in Kyoto'],
  ['osaka-leg', 'delete the Osaka leg'],
  ['dress-code', 'take out the dress code'],
  ['rename-day3', 'rename day 3 to "Nikko and Toshogu shrine"'],
  ['cafe-day2', 'add a cafe to day 2'],
  ['money-note', 'remove the Money note'],
  ['tokyo-hotel', 'we are not staying at Park Hotel Tokyo anymore, remove it'],
];
const has = (c, re) => c.schedule.some(x => re.test(x.title + ' ' + (x.note || '')));
const customText = (c) => (c.custom || []).map(x => x.title + '\n' + x.text).join('\n');
export const CHECKS = {
  'kyoto-hotel': (c) => !has(c, /granvia/i) && !/granvia/i.test(customText(c)) && /Park Hotel Tokyo/.test(customText(c)) && /Cross Hotel Osaka/.test(customText(c)) && c.stops.length === 3 && c.schedule.length === 7,
  'osaka-leg': (c) => c.stops.map(s => s.name).join() === 'Tokyo,Kyoto' && has(c, /Park Hotel/) && has(c, /Granvia/),
  'dress-code': (c) => !(c.custom || []).some(x => /dress/i.test(x.title) && x.text.trim()) && (c.custom || []).some(x => x.title === 'Hotels') && c.schedule.length === 8,
  'rename-day3': (c) => c.schedule.length === 8 && c.schedule.some(x => x.date === '2027-04-03' && /Toshogu/.test(x.title)) && !has(c, /^Day 3: Nikko day trip/),
  'cafe-day2': (c) => c.schedule.length === 9 && c.schedule.some(x => x.date === '2027-04-02' && /caf/i.test(x.title)) && has(c, /Tsukiji/),
  'money-note': (c) => !c.notes.length && c.schedule.length === 8 && (c.custom || []).length === 2,
  'tokyo-hotel': (c) => !has(c, /Park Hotel/) && !/Park Hotel/.test(customText(c)) && has(c, /Granvia/) && /Granvia/.test(customText(c)),
};
