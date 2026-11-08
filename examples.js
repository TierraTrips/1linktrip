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
    theme: { accent: '#3048F0', font: 'grotesk', mode: 'light' },
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
    tagline: 'Tokyo, Kyoto and Osaka in ten days',
    host: '',
    description: 'Cherry blossom season: four nights in Tokyo, three in Kyoto, two in Osaka. Shinkansen between cities.',
    start: '2027-04-02',
    end: '2027-04-11',
    tz: 'Asia/Tokyo',
    venue: { name: 'Tokyo', address: 'Shinjuku, Tokyo, Japan', lat: 35.68972, lon: 139.69222, city: 'Tokyo', region: 'Tokyo', country: 'Japan', cc: 'jp' },
    cover: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/0e/Torii_path_with_lantern_at_Fushimi_Inari_Taisha_Shrine%2C_Kyoto%2C_Japan.jpg/1280px-Torii_path_with_lantern_at_Fushimi_Inari_Taisha_Shrine%2C_Kyoto%2C_Japan.jpg',
    theme: { accent: '#C2185B', font: 'serif', mode: 'light' },
    tools: { weather: true, travel: true, stay: true, nearby: true, tours: true, mytrip: true, packing: true },
    off: { rsvp: true },
    schedule: [
      { date: '2027-04-02', time: '15:30', title: 'Land at Haneda', note: 'Keikyu line to Shinagawa, then JR to Shinjuku', kind: 'activity' },
      { date: '2027-04-02', time: '', title: 'Check in, Shinjuku hotel', note: 'Sample booking, conf. SAMPLE-0001', kind: 'reservation' },
      { date: '2027-04-03', time: '', title: 'Shinjuku Gyoen for the cherry blossoms', note: 'Opens 9:00, small entry fee', kind: 'activity' },
      { date: '2027-04-03', time: '19:00', title: 'Dinner in Omoide Yokocho', note: '', kind: 'activity' },
      { date: '2027-04-04', time: '', title: 'Asakusa and Senso-ji, then a river cruise', note: '', kind: 'activity' },
      { date: '2027-04-05', time: '', title: 'Day trip to Nikko', note: 'Get the Nikko pass at Asakusa station', kind: 'activity' },
      { date: '2027-04-06', time: '10:00', title: 'Shinkansen to Kyoto', note: 'Nozomi from Tokyo station, about 2 h 15 min. Reserved seats.', kind: 'reservation' },
      { date: '2027-04-06', time: '', title: 'Check in, Kyoto ryokan', note: 'Sample booking, conf. SAMPLE-0002', kind: 'reservation' },
      { date: '2027-04-07', time: '07:00', title: 'Fushimi Inari before the crowds', note: '', kind: 'activity' },
      { date: '2027-04-08', time: '', title: 'Arashiyama bamboo grove and Tenryu-ji', note: '', kind: 'activity' },
      { date: '2027-04-09', time: '', title: 'Train to Osaka', note: 'JR Special Rapid, about 30 min', kind: 'activity' },
      { date: '2027-04-09', time: '19:00', title: 'Dotonbori street food', note: '', kind: 'activity' },
      { date: '2027-04-10', time: '', title: 'Osaka Castle park', note: '', kind: 'activity' },
      { date: '2027-04-11', time: '', title: 'Fly home from Kansai', note: 'Leave Namba by 9:00 on the Nankai Rapi:t', kind: 'note' }
    ],
    notes: [{ label: 'Money', text: 'Cash is still handy: get yen at a 7-Eleven ATM. Load a Suica or ICOCA card on your phone for trains.', url: '' }],
    stops: [
      { name: 'Tokyo', address: 'Tokyo, Japan', lat: 35.68972, lon: 139.69222, city: 'Tokyo', region: 'Tokyo', country: 'Japan', cc: 'jp', from: '2027-04-02', to: '2027-04-06' },
      { name: 'Kyoto', address: 'Kyoto, Japan', lat: 35.01164, lon: 135.76803, city: 'Kyoto', region: 'Kyoto', country: 'Japan', cc: 'jp', from: '2027-04-06', to: '2027-04-09' },
      { name: 'Osaka', address: 'Osaka, Japan', lat: 34.69374, lon: 135.50218, city: 'Osaka', region: 'Osaka', country: 'Japan', cc: 'jp', from: '2027-04-09', to: '2027-04-11' }
    ],
    x: { Trip: { companions: '' } },
    bring: 'Passport\nPower adapter (type A)\nComfortable walking shoes'
  }
};
