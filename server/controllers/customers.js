const { simpleResource } = require('./simpleResource');
const { text } = require('../lib/validate');

module.exports = simpleResource({
  table: 'customers',
  label: 'Customer',
  parse: (body) => ({
    name: text(body.name, 'Name', { required: true, max: 150 }),
    phone: text(body.phone, 'Phone', { max: 40 }),
    email: text(body.email, 'Email', { max: 150 }),
    address: text(body.address, 'Address', { max: 500 }),
    notes: text(body.notes, 'Notes', { max: 2000 }),
  }),
});
