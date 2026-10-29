// Test fixtures shared across suites.

export const person = (overrides = {}) => ({
  lastName: 'Abebe',
  firstName: 'Kebede',
  gender: 'male',
  birthDate: '1995-04-12',
  birthCity: 'Addis Ababa',
  birthCountry: 'Ethiopia',
  ...overrides,
});

export const applicantInput = (overrides = {}) => ({
  ...person(),
  eligibilityCountry: 'Ethiopia',
  mailingAddress: 'Bole, Addis Ababa',
  residenceCountry: 'Ethiopia',
  email: 'kebede@example.com',
  education: 'university_degree',
  maritalStatus: 'unmarried',
  children: [],
  ...overrides,
});

// Smallest buffer jpegDimensions() accepts: SOI + SOF0 header with the given size.
export function fakeJpeg(width = 600, height = 600, padTo = 0) {
  const sof = Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, 0, 0, 0, 0, 0x03]);
  sof.writeUInt16BE(height, 5);
  sof.writeUInt16BE(width, 7);
  const buf = Buffer.concat([Buffer.from([0xff, 0xd8]), sof, Buffer.alloc(20)]);
  return padTo > buf.length ? Buffer.concat([buf, Buffer.alloc(padTo - buf.length)]) : buf;
}
