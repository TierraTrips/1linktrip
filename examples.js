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
    sections: ['about', 'schedule', 'weather', 'map', 'travel', 'stay', 'food', 'around', 'links', 'calendar'].map(id => ({ id, on: true })),
    schedule: [
      { date: '2026-11-18', time: '08:00', title: 'Badge pickup and coffee', note: 'North Concourse' },
      { date: '2026-11-18', time: '09:30', title: 'Opening keynote', note: 'Main stage, Hall 1A' },
      { date: '2026-11-18', time: '11:00', title: 'Breakout tracks', note: 'Rooms 1E01–1E16' },
      { date: '2026-11-18', time: '18:30', title: 'Opening night party', note: 'Javits rooftop' },
      { date: '2026-11-19', time: '09:00', title: 'Hands-on workshops', note: 'Bring a laptop' },
      { date: '2026-11-19', time: '16:30', title: 'Closing panel', note: 'Main stage, Hall 1A' }
    ],
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
    sections: ['about', 'schedule', 'links', 'weather', 'travel', 'stay', 'food', 'around', 'map', 'calendar'].map(id => ({ id, on: true })),
    schedule: [
      { date: '2027-03-12', time: '19:00', title: 'Welcome drinks', note: 'Casual. Sandals encouraged.' },
      { date: '2027-03-13', time: '16:30', title: 'Ceremony', note: 'On the beach. Please arrive by 4:15.' },
      { date: '2027-03-13', time: '18:00', title: 'Dinner', note: 'Under the palms' },
      { date: '2027-03-13', time: '20:30', title: 'Dancing', note: '' },
      { date: '2027-03-14', time: '11:00', title: 'Farewell brunch', note: 'Come as you are' }
    ],
    links: [
      { label: 'Dress code', note: 'Beach formal. Linen is perfect; leave the stilettos at home.' },
      { label: 'RSVP', note: 'Please reply to the invitation card by January 15.' },
      { label: 'Kids', note: 'Little ones are welcome at the welcome drinks and brunch.' }
    ]
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
    sections: ['about', 'schedule', 'around', 'map', 'weather', 'links', 'travel', 'stay', 'food', 'calendar'].map(id => ({ id, on: true })),
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
  }
};
