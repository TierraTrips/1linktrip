// Prefilled demo events. Fictional events at real venues; every URL here was checked to resolve.
window.EXAMPLES = {
  'nyc-conference': {
    v: 1,
    type: 'Conference',
    title: 'Signal & Noise 2026',
    tagline: 'Two days on data, design and the tools in between.',
    host: 'Signal & Noise',
    description: 'Talks, workshops and a lot of hallway conversations about how teams turn data into decisions people can actually use.\n\nBadge pickup opens at 8:00 AM on the North Concourse. Bring a photo ID; badges are not transferable.\n\nThe Javits Center is a short walk from the 34 St–Hudson Yards station on the 7 line.',
    start: '2026-11-18T09:00',
    end: '2026-11-19T18:00',
    tz: 'America/New_York',
    venue: {
      name: 'Javits Center',
      address: '429 11th Ave, New York, NY 10001',
      lat: 40.75836, lon: -74.00221, city: 'New York', region: 'New York', country: 'United States', cc: 'us'
    },
    cover: 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/18/Javits_Center_November_2022.jpg/1280px-Javits_Center_November_2022.jpg',
    theme: { accent: '#0F4A50', font: 'field', mode: 'light' },
    custom: [{ id: 'wifi', title: 'Getting there', text: 'Take the 7 train to 34 St–Hudson Yards; the Javits Center is a short walk west. Leave time for the security line at the North Concourse.', label: '', url: '', img: '' }],
    files: [{ id: 'nc1', sec: 'schedule', name: 'Program.pdf', url: 'https://1linktrip.com/examples/signal-noise-program.pdf', type: 'pdf', size: 32562 }],
    demoTrip: {
      itin: [
        { id: 'dn1', kind: 'hotel', name: 'Hilton Garden Inn New York/Times Square Central', address: '136 W 42nd St, New York, NY', start: '2026-11-17T15:00', end: '2026-11-20T11:00', confNo: 'SAMPLE1', via: 'amex' }
      ],
      plan: [
        { id: 'dns1', src: 'g', ref: 'ChIJifIePKtZwokRVZ-UdRGkZzs', name: "Joe's Pizza Broadway", lat: 40.75468, lon: -73.98703, addr: '1435 Broadway, New York', rating: 4.4, count: 27614, type: 'food', day: '' },
        { id: 'dns2', src: 'g', ref: 'ChIJ5bQPhMdZwokRkTwKhVxhP1g', name: 'The High Line', lat: 40.74799, lon: -74.00476, addr: 'New York', rating: 4.7, count: 69078, type: 'activity', day: '2026-11-19', time: '18:00' },
        { id: 'dns3', src: 'g', ref: 'ChIJL-CJmTFZwokRsPcqje_bn7w', name: 'Little Island', lat: 40.742, lon: -74.0103, addr: 'Pier 55, Hudson River Park, New York', rating: 4.7, count: 18113, type: 'activity', day: '' }
      ]
    },
    sections: ['about', 'typeinfo', 'schedule', 'weather', 'map', 'travel', 'stay', 'food', 'tours', 'around', 'links', 'packing', 'calendar'].map(id => ({ id, on: true })),
    schedule: [
      { date: '2026-11-18', time: '08:00', title: 'Badge pickup and coffee', note: 'North Concourse' },
      { date: '2026-11-18', time: '09:30', title: 'Opening keynote', note: 'Main stage, Hall 1A' },
      { date: '2026-11-18', time: '11:00', title: 'Breakout tracks', note: 'Rooms 1E01–1E16' },
      { date: '2026-11-18', time: '18:30', title: 'Opening night party', note: 'Javits rooftop' },
      { date: '2026-11-19', time: '09:00', title: 'Hands-on workshops', note: 'Bring a laptop' },
      { date: '2026-11-19', time: '16:30', title: 'Closing panel', note: 'Main stage, Hall 1A' }
    ],
    x: { Conference: { badge: 'North Concourse', badgeWhen: '2026-11-18T08:00' } },
    links: [
      { label: 'Venue information', url: 'https://www.javitscenter.com/' },
      { label: 'Subway and bus service', url: 'https://new.mta.info/' },
      { label: 'Dress code', note: 'Business casual. The halls run cold, so bring a layer.' }
    ]
  },

  'tulum-wedding': {
    v: 1,
    type: 'Wedding',
    title: 'Maya & Theo',
    tagline: 'Getting married on the beach in Tulum',
    host: 'Maya Ortiz & Theo Lindqvist',
    description: 'We would love for you to spend a long weekend with us on the Caribbean coast. The ceremony is on the sand at sunset, followed by dinner and dancing under the palms.\n\nTulum has its own international airport (TQO), about 30 minutes from the beach. Cancún (CUN) has more flights and is about 1 hour 45 minutes away by car.',
    start: '2027-03-13T16:30',
    end: '2027-03-13T23:30',
    tz: 'America/Cancun',
    venue: {
      name: 'Playa Paraíso',
      address: 'Playa Paraíso, Tulum, Quintana Roo, México',
      lat: 20.20404, lon: -87.43127, city: 'Tulum', region: 'Quintana Roo', country: 'Mexico', cc: 'mx'
    },
    cover: 'https://upload.wikimedia.org/wikipedia/commons/thumb/f/ff/Mexico_-_beach_by_Tulum%2C_2022.jpg/1280px-Mexico_-_beach_by_Tulum%2C_2022.jpg',
    theme: { accent: '#0B7A75', font: 'serif', mode: 'light' },
    custom: [{ id: 'kids', title: 'Getting around Tulum', text: 'Taxis wait outside the hotels on the beach road; agree on the fare before you get in. Bikes are the easiest way between the beach and town.', label: '', url: '', img: '' }],
    files: [{ id: 'tw1', sec: 'schedule', name: 'Wedding weekend.pdf', url: 'https://1linktrip.com/examples/maya-theo-weekend.pdf', type: 'pdf', size: 33583 }],
    demoTrip: {
      itin: [
        { id: 'dw1', kind: 'flight', name: 'Flight into Tulum (TQO)', start: '2027-03-12T11:00', end: '2027-03-12T15:30', to: 'TQO', confNo: 'SAMPLE1', via: 'direct' },
        { id: 'dw2', kind: 'hotel', name: 'Papaya Playa Project', address: 'Carr. Tulum-Boca Paila Km 4.5, Tulum Beach', start: '2027-03-12T15:00', end: '2027-03-15T11:00', confNo: 'SAMPLE2', via: 'booking' },
        { id: 'dw3', kind: 'car', name: 'Rental car at Tulum airport', start: '2027-03-12T16:00', end: '2027-03-15T09:00', confNo: 'SAMPLE3', via: 'kayak' }
      ],
      plan: [
        { id: 'dws1', src: 'g', ref: 'ChIJlVcVFcvQT48Rdbm9qF4Emow', name: 'Hartwood', lat: 20.14988, lon: -87.45937, addr: 'Carr. Tulum-Boca Paila Km 7.6, Tulum Beach', rating: 4.4, count: 1584, type: 'food', day: '2027-03-14', time: '19:30' }
      ],
      shop: [{ id: 'dwsh1', text: 'Sunscreen (reef-safe)', city: '', note: 'Required in the cenotes', done: false }]
    },
    sections: ['about', 'typeinfo', 'schedule', 'links', 'weather', 'travel', 'stay', 'food', 'tours', 'around', 'map', 'packing', 'calendar'].map(id => ({ id, on: true })),
    schedule: [
      { date: '2027-03-12', time: '19:00', title: 'Welcome drinks', note: 'Casual. Sandals encouraged.' },
      { date: '2027-03-13', time: '16:30', title: 'Ceremony', note: 'On the beach. Please arrive by 4:15.' },
      { date: '2027-03-13', time: '18:00', title: 'Dinner', note: 'Under the palms' },
      { date: '2027-03-13', time: '20:30', title: 'Dancing', note: '' },
      { date: '2027-03-14', time: '11:00', title: 'Farewell brunch', note: 'Come as you are' }
    ],
    x: { Wedding: { dress: 'Beach formal. Linen is perfect; leave the stilettos at home.', rsvpBy: '2027-01-15' } },
    links: [
      { label: 'Kids', note: 'Little ones are welcome at the welcome drinks and brunch.' }
    ]
  },

  'chicago-10k': {
    v: 1,
    type: 'Race',
    title: 'Lakefront 10K',
    tagline: 'A flat, fast spring 10K along the Chicago lakefront',
    host: 'Lakefront Running Club',
    description: 'Point to point from Buckingham Fountain to the Adler Planetarium, with the skyline at your back and the lake on your left.\n\nThe course is flat and chip timed. Waves start every five minutes from 7:00 AM; the course closes at 9:30 AM.',
    start: '2027-05-16T07:00',
    end: '2027-05-16T10:00',
    tz: 'America/Chicago',
    venue: {
      name: 'Buckingham Fountain',
      address: 'South Columbus Drive, Chicago, IL 60605',
      lat: 41.8758, lon: -87.61897, city: 'Chicago', region: 'Illinois', country: 'United States', cc: 'us'
    },
    cover: 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/1e/Buckingham_Fountain_%26_Chicago_skyline%2C_Aug_10.jpg/1280px-Buckingham_Fountain_%26_Chicago_skyline%2C_Aug_10.jpg',
    theme: { accent: '#2E7D32', font: 'wide', mode: 'light' },
    custom: [{ id: 'course', title: 'After the race', text: 'Stay for the awards at the finish by the Adler Planetarium, then walk the lakefront trail back toward downtown.', label: '', url: '', img: '' }],
    files: [{ id: 'ck1', sec: 'schedule', name: 'Course and race morning.pdf', url: 'https://1linktrip.com/examples/lakefront-10k-course.pdf', type: 'pdf', size: 33982 }],
    demoTrip: {
      itin: [
        { id: 'dc1', kind: 'hotel', name: 'Hilton Chicago', address: '720 S Michigan Ave, Chicago, IL', start: '2027-05-15T15:00', end: '2027-05-17T11:00', confNo: 'SAMPLE1', via: 'direct' }
      ],
      plan: [
        { id: 'dcs1', src: 'g', ref: 'ChIJbwD-GqYsDogRFT9FTurCL5U', name: 'Wildberry Pancakes & Cafe', lat: 41.88472, lon: -87.62286, addr: '130 E Randolph St, Chicago', rating: 4.6, count: 10156, type: 'food', day: '2027-05-16', time: '10:30' }
      ]
    },
    sections: ['about', 'typeinfo', 'schedule', 'map', 'weather', 'travel', 'stay', 'food', 'tours', 'around', 'packing', 'calendar'].map(id => ({ id, on: true })),
    schedule: [
      { date: '2027-05-15', time: '10:00', title: 'Packet pickup opens', note: 'Lower Hutchinson Field, until 5 PM' },
      { date: '2027-05-16', time: '06:00', title: 'Gear check opens', note: 'Next to the start corrals' },
      { date: '2027-05-16', time: '07:00', title: 'First wave starts', note: 'Buckingham Fountain' },
      { date: '2027-05-16', time: '08:30', title: 'Awards', note: 'Finish area, Adler Planetarium' }
    ],
    x: { Race: {
      startAt: { q: 'Buckingham Fountain', lat: 41.8758, lon: -87.61897 },
      finishAt: { q: 'Adler Planetarium', lat: 41.86637, lon: -87.60663 },
      packet: 'Lower Hutchinson Field', packetWhen: '2027-05-15T10:00',
      spots: 'Museum Campus\nNortherly Island',
      closures: 'Columbus Drive between Balbo and Roosevelt is closed from 5 to 10 AM on race morning.'
    } },
    bring: 'Photo ID for packet pickup',
    links: []
  },

  'sf-festival': {
    v: 1,
    type: 'Festival',
    title: 'Fog City Sounds',
    tagline: 'Three days of music in Golden Gate Park',
    host: '',
    description: 'Four stages, sixty artists and a lot of fog. Gates open at 11 AM each day; music runs until 10 PM.\n\nThere is no parking at the festival. Take Muni, ride a bike (free bike valet at the Polo Field entrance) or walk in along JFK Promenade.',
    start: '2027-08-06T11:00',
    end: '2027-08-08T22:00',
    tz: 'America/Los_Angeles',
    venue: {
      name: 'Hellman Hollow, Golden Gate Park',
      address: 'Hellman Hollow, Golden Gate Park, San Francisco, CA',
      lat: 37.76916, lon: -122.48568, city: 'San Francisco', region: 'California', country: 'United States', cc: 'us'
    },
    cover: 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/12/Hardly_Strictly_Crowd_%28cropped%29.jpg/1280px-Hardly_Strictly_Crowd_%28cropped%29.jpg',
    theme: { accent: '#FF6B35', font: 'condensed', mode: 'dark' },
    sections: ['about', 'schedule', 'around', 'map', 'weather', 'links', 'travel', 'stay', 'food', 'tours', 'packing', 'calendar'].map(id => ({ id, on: true })),
    schedule: [
      { date: '2027-08-06', time: '11:00', title: 'Gates open', note: 'All three days' },
      { date: '2027-08-06', time: '20:15', title: 'Friday headliner', note: 'Meadow Stage' },
      { date: '2027-08-07', time: '13:00', title: 'Local showcase', note: 'Hollow Stage' },
      { date: '2027-08-07', time: '20:15', title: 'Saturday headliner', note: 'Meadow Stage' },
      { date: '2027-08-08', time: '19:45', title: 'Closing set', note: 'Meadow Stage' }
    ],
    links: [
      { label: 'Muni routes and fares', url: 'https://www.sfmta.com/' },
      { label: 'Bags', note: 'Clear bags up to 12 x 6 x 12 in, or small clutches.' },
      { label: 'Layers', note: 'August afternoons in the park can drop into the 50s °F. Bring a jacket.' }
    ]
  },
  'redrocks-concert': {
    v: 2,
    type: 'Concert',
    title: 'Canyon Lights Live',
    tagline: 'Two bands, one amphitheatre, the whole night sky',
    host: 'Canyon Lights',
    description: 'A summer night at Red Rocks with The Long Echo headlining and Paper Kites Club opening.\n\nThe venue is outdoors and about 6,400 ft up: bring a layer and water. The walk from the upper lot to the seats is steep.',
    start: '2027-06-19T19:00',
    end: '2027-06-19T23:00',
    tz: 'America/Denver',
    venue: { name: 'Red Rocks Amphitheatre', address: '18300 W Alameda Pkwy, Morrison, CO 80465', lat: 39.66528, lon: -105.20583, city: 'Morrison', region: 'Colorado', country: 'United States', cc: 'us' },
    cover: 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/33/RedRocksAMP.png/1280px-RedRocksAMP.png',
    theme: { accent: '#FF6B35', font: 'condensed', mode: 'dark' },
    tools: { weather: true, travel: true, stay: true, nearby: true, tours: true, mytrip: true, packing: true },
    off: {},
    schedule: [
      { date: '2027-06-19', time: '17:30', title: 'Parking lots open', note: 'Upper North and Lower North lots' },
      { date: '2027-06-19', time: '22:45', title: 'Shuttle back to Denver', note: 'Leaves from the lower south lot' }
    ],
    notes: [{ label: 'Altitude', text: 'Drink water before you climb the stairs, and take it slow.', url: '' }],
    x: { Concert: { doors: '18:00', opener: 'Paper Kites Club', openerAt: '19:00', headliner: 'The Long Echo', headlinerAt: '20:30', bags: 'Clear bags up to 12 x 6 x 12 in, or small clutches', parking: 'Free general parking in the venue lots', pickup: 'Rideshare pickup is in the lower south lot' } },
    bring: 'A warm layer\nRefillable water bottle (empty)'
  },
  'japan-trip': {
    v: 2,
    type: 'Trip',
    title: 'Japan in spring',
    tagline: 'Tokyo, Kyoto, Osaka and back to Tokyo in ten days',
    host: '',
    description: 'Cherry blossom season: three nights in Tokyo, three in Kyoto, one in Osaka and two more back in Tokyo. Shinkansen between cities.',
    start: '2027-04-02',
    end: '2027-04-11',
    tz: 'Asia/Tokyo',
    venue: { name: 'Tokyo', address: 'Shinjuku, Tokyo, Japan', lat: 35.68972, lon: 139.69222, city: 'Tokyo', region: 'Tokyo', country: 'Japan', cc: 'jp' },
    cover: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/0e/Torii_path_with_lantern_at_Fushimi_Inari_Taisha_Shrine%2C_Kyoto%2C_Japan.jpg/1280px-Torii_path_with_lantern_at_Fushimi_Inari_Taisha_Shrine%2C_Kyoto%2C_Japan.jpg',
    theme: { accent: '#C2185B', font: 'serif', mode: 'light' },
    tools: { weather: true, travel: true, stay: true, nearby: true, tours: true, mytrip: true, packing: true, shopping: true },
    off: { rsvp: true },
    schedule: [
      { date: '2027-04-02', time: '15:30', title: 'Land at Haneda', note: 'Keikyu line to Shimbashi, then a short walk to the hotel', kind: 'activity' },
      { date: '2027-04-02', time: '18:00', title: 'Check in: Park Hotel Tokyo', note: 'Shiodome Media Tower, lobby on the 25th floor', kind: 'reservation' },
      { date: '2027-04-03', time: '09:00', title: 'Shinjuku Gyoen for the cherry blossoms', note: 'Opens 9:00; small entry fee, no alcohol inside', kind: 'activity' },
      { date: '2027-04-03', time: '19:00', title: 'Dinner in Omoide Yokocho', note: 'Tiny yakitori counters by Shinjuku station; cash only', kind: 'activity' },
      { date: '2027-04-04', time: '10:00', title: 'Asakusa and Senso-ji', note: 'Nakamise street snacks on the way in', kind: 'activity' },
      { date: '2027-04-04', time: '17:00', title: 'teamLab Planets', note: 'Toyosu; timed tickets, you walk barefoot through water', kind: 'reservation' },
      { date: '2027-04-05', time: '10:00', title: 'Shinkansen to Kyoto', note: 'Nozomi from Tokyo station, about 2 h 15 min. Reserved seats.', kind: 'reservation' },
      { date: '2027-04-05', time: '15:00', title: 'Check in: Hotel Granvia Kyoto', note: 'Inside Kyoto Station', kind: 'reservation' },
      { date: '2027-04-06', time: '07:00', title: 'Fushimi Inari before the crowds', note: 'JR Nara line to Inari station, 5 minutes from Kyoto', kind: 'activity' },
      { date: '2027-04-06', time: '12:30', title: 'Lunch at Nishiki Market', note: '', kind: 'activity' },
      { date: '2027-04-07', time: '08:30', title: 'Arashiyama bamboo grove and Tenryu-ji', note: 'Coffee at % Arabica by the river', kind: 'activity' },
      { date: '2027-04-08', time: '11:00', title: 'Train to Osaka', note: 'JR Special Rapid, about 30 min', kind: 'activity' },
      { date: '2027-04-08', time: '15:00', title: 'Check in: Cross Hotel Osaka', note: 'Shinsaibashi, a short walk to Dotonbori', kind: 'reservation' },
      { date: '2027-04-08', time: '19:00', title: 'Dotonbori street food', note: 'Takoyaki and okonomiyaki along the canal', kind: 'activity' },
      { date: '2027-04-09', time: '09:00', title: 'Osaka Castle park', note: '', kind: 'activity' },
      { date: '2027-04-09', time: '14:00', title: 'Shinkansen back to Tokyo', note: 'From Shin-Osaka, about 2 h 30 min', kind: 'reservation' },
      { date: '2027-04-09', time: '17:30', title: 'Check in: Hotel Gracery Shinjuku', note: 'The one with Godzilla on the roof', kind: 'reservation' },
      { date: '2027-04-10', time: '08:00', title: 'Tsukiji Outer Market breakfast', note: '', kind: 'activity' },
      { date: '2027-04-11', time: '17:00', title: 'Fly home from Haneda', note: 'Leave the hotel by 14:00', kind: 'reservation' }
    ],
    notes: [
      { label: 'Money', text: 'Cash is still handy: get yen at a 7-Eleven ATM. Load a Suica or ICOCA card on your phone for trains.', url: '' },
      { label: 'Luggage', text: 'Send big bags ahead between hotels with takkyubin (ask at the front desk) and travel light on the Shinkansen.', url: '' }
    ],
    custom: [
      { id: 'getaround', title: 'Getting around', text: 'Trains do almost everything. A Suica card on your phone works on trains, buses and in convenience stores across all three cities.\n\nShinkansen seats: reserve them a few days ahead in cherry blossom season.', label: 'JR Pass and Shinkansen', url: 'https://japanrailpass.net/en/', img: '' },
      { id: 'sos', title: 'Emergency numbers', text: 'Police 110\nAmbulance and fire 119\nJapan Visitor Hotline (24 h, English) +81 50 3816 2787', label: '', url: '', img: '' }
    ],
    files: [{ id: 'jp1', sec: 'route', name: 'Japan trip plan.pdf', url: 'https://1linktrip.com/examples/japan-trip-plan.pdf', type: 'pdf', size: 41670 }],
    stops: [
      { name: 'Tokyo', address: 'Tokyo, Japan', lat: 35.68972, lon: 139.69222, city: 'Tokyo', region: 'Tokyo', country: 'Japan', cc: 'jp', from: '2027-04-02', to: '2027-04-05' },
      { name: 'Kyoto', address: 'Kyoto, Japan', lat: 35.01164, lon: 135.76803, city: 'Kyoto', region: 'Kyoto', country: 'Japan', cc: 'jp', from: '2027-04-05', to: '2027-04-08' },
      { name: 'Osaka', address: 'Osaka, Japan', lat: 34.69374, lon: 135.50218, city: 'Osaka', region: 'Osaka', country: 'Japan', cc: 'jp', from: '2027-04-08', to: '2027-04-09' },
      { name: 'Tokyo', address: 'Tokyo, Japan', lat: 35.68972, lon: 139.69222, city: 'Tokyo', region: 'Tokyo', country: 'Japan', cc: 'jp', from: '2027-04-09', to: '2027-04-11' }
    ],
    x: { Trip: { companions: '' } },
    bring: 'Passport\nPower adapter (type A)\nComfortable walking shoes',
    // sample My trip for the example page (shown until the visitor changes it; never copied into an edited page)
    demoTrip: {
      itin: [
        { id: 'dm1', kind: 'flight', name: 'ANA · Los Angeles → Tokyo Haneda', start: '2027-04-01T12:30', end: '2027-04-02T16:20', to: 'HND', confNo: 'SAMPLE1', via: 'expedia' },
        { id: 'dm2', kind: 'hotel', name: 'Park Hotel Tokyo', address: '1-7-1 Higashi-Shimbashi, Minato City, Tokyo', start: '2027-04-02T15:00', end: '2027-04-05T11:00', confNo: 'SAMPLE2', via: 'booking' },
        { id: 'dm3', kind: 'train', name: 'Shinkansen Tokyo → Kyoto', start: '2027-04-05T10:00', end: '2027-04-05T12:15', confNo: 'SAMPLE3', via: 'direct' },
        { id: 'dm4', kind: 'hotel', name: 'Hotel Granvia Kyoto', address: 'Kyoto Station, Shimogyo Ward, Kyoto', start: '2027-04-05T15:00', end: '2027-04-08T11:00', confNo: 'SAMPLE4', via: 'direct' },
        { id: 'dm5', kind: 'hotel', name: 'Cross Hotel Osaka', address: '2-5-15 Shinsaibashisuji, Chuo Ward, Osaka', start: '2027-04-08T15:00', end: '2027-04-09T11:00', confNo: 'SAMPLE5', via: 'agoda' },
        { id: 'dm6', kind: 'hotel', name: 'Hotel Gracery Shinjuku', address: '1-19-1 Kabukicho, Shinjuku City, Tokyo', start: '2027-04-09T15:00', end: '2027-04-11T11:00', confNo: 'SAMPLE6', via: 'booking' },
        { id: 'dm7', kind: 'car', name: 'Toyota Rent-a-Car, Shinjuku-sanchome', address: '4-2-18 Shinjuku, Shinjuku City, Tokyo', start: '2027-04-10T09:00', end: '2027-04-10T20:00', confNo: 'SAMPLE7', via: 'direct' },
        { id: 'dm8', kind: 'other', name: 'teamLab Planets tickets', address: '6-1-16 Toyosu, Koto City, Tokyo', start: '2027-04-04T17:00', confNo: 'SAMPLE8', via: 'direct' },
        { id: 'dm9', kind: 'flight', name: 'ANA · Tokyo Haneda → Los Angeles', start: '2027-04-11T17:00', end: '2027-04-11T11:00', to: 'LAX', confNo: 'SAMPLE1', via: 'expedia' }
      ],
      plan: [
        { id: 'ds1', src: 'g', ref: 'ChIJ8QwFX9qMGGARVm0p0caIeTk', name: 'Ichiran Shinjuku', lat: 35.69059, lon: 139.70281, addr: 'Peace Bldg. B1F, 3-34-11 Shinjuku, Tokyo', rating: 4.3, count: 7855, type: 'food', day: '' },
        { id: 'ds2', src: 'g', ref: 'ChIJ508frs-MGGARnIKrb_tkai0', name: 'Fuunji Shinjuku', lat: 35.68683, lon: 139.69664, addr: '2-14-3 Yoyogi, Shibuya, Tokyo', rating: 4.3, count: 5791, type: 'food', day: '' },
        { id: 'ds3', src: 'g', ref: 'ChIJVVVp3BaJGGARfAgSR2yEybw', name: 'Blue Bottle Coffee Kiyosumi-Shirakawa', lat: 35.67776, lon: 139.80059, addr: '1-4-8 Hirano, Koto City, Tokyo', rating: 4.1, count: 5102, type: 'food', day: '' },
        { id: 'ds4', src: 'g', ref: 'ChIJW2cLzSGLGGARXAKXv6EkbqI', name: 'Tsukiji Outer Market', lat: 35.66477, lon: 139.77025, addr: 'Tsukiji 4-chome, Chuo City, Tokyo', rating: 4.2, count: 56400, type: 'food', day: '2027-04-10', time: '08:00' },
        { id: 'ds5', src: 'g', ref: 'ChIJCWDv__-pAWARwLeeqs_cVew', name: '% Arabica Kyoto Arashiyama', lat: 35.01354, lon: 135.67644, addr: '3-47 Sagatenryuji Susukinobabacho, Ukyo Ward, Kyoto', rating: 4.2, count: 5828, type: 'food', day: '2027-04-07', time: '08:00' },
        { id: 'ds6', src: 'g', ref: 'ChIJT8uMzZwIAWARnGzsARCjnrY', name: 'Nishiki Market', lat: 35.00503, lon: 135.76472, addr: 'Nakagyo Ward, Kyoto', rating: 4.3, count: 55557, type: 'food', day: '' },
        { id: 'ds7', src: 'g', ref: 'ChIJXSJB5UHnAGARQcEjvngsHaw', name: 'Kuromon Market', lat: 34.66535, lon: 135.50624, addr: '2-4-1 Nipponbashi, Chuo Ward, Osaka', rating: 4.1, count: 21447, type: 'food', day: '' }
      ],
      shop: [
        { id: 'dsh1', text: 'Matcha from Ippodo', city: 'Kyoto', note: 'A small tin for home', done: false },
        { id: 'dsh2', text: 'Regional Kit Kats', city: 'Tokyo', note: '', done: false },
        { id: 'dsh3', text: 'Kitchen knife from Kappabashi', city: 'Tokyo', note: '', done: false },
        { id: 'dsh4', text: 'Furoshiki wrapping cloth', city: '', note: '', done: true }
      ],
      pack: { custom: [{ id: 'c:dm1', text: 'Coin purse (lots of ¥100 coins)' }, { id: 'c:dm2', text: 'Small towel (many restrooms have no paper towels)' }] }
    }
  }
};
