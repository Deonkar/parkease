export const BANGALORE_FIXTURES = [
  {
    title: 'Covered parking near Forum Mall',
    area: 'Koramangala',
    addressLine: '80 Feet Road, Koramangala 4th Block',
    city: 'Bangalore',
    state: 'Karnataka',
    pincode: '560034',
    location: { lat: 12.9352, lng: 77.6245 },
    slots: { car: 2, two_wheeler: 4 },
    pricePaiseHourly: { car: 3000, two_wheeler: 1500 },
  },
  {
    title: 'Gated apartment slot, HSR Sector 2',
    area: 'HSR Layout',
    addressLine: '27th Main, HSR Layout Sector 2',
    city: 'Bangalore',
    state: 'Karnataka',
    pincode: '560102',
    location: { lat: 12.9116, lng: 77.6389 },
    slots: { car: 1, two_wheeler: 2 },
    pricePaiseHourly: { car: 2500, two_wheeler: 1200 },
  },
  {
    title: 'Driveway off 100 Feet Road',
    area: 'Indiranagar',
    addressLine: '100 Feet Road, Indiranagar',
    city: 'Bangalore',
    state: 'Karnataka',
    pincode: '560038',
    location: { lat: 12.9784, lng: 77.6408 },
    slots: { car: 3 },
    pricePaiseHourly: { car: 4000 },
  },
] as const;

export const SEED_USERS = {
  driver: {
    phone: '+919900000001',
    name: 'Dev Driver',
    firebaseUid: 'seed:driver:+919900000001',
  },
  ownerDriver: {
    phone: '+919900000002',
    name: 'Dev Owner (also Driver)',
    firebaseUid: 'seed:owner:+919900000002',
  },
  valet: {
    phone: '+919900000003',
    name: 'Dev Valet',
    firebaseUid: 'seed:valet:+919900000003',
  },
  washer: {
    phone: '+919900000004',
    name: 'Dev Washer',
    firebaseUid: 'seed:washer:+919900000004',
  },
} as const;
