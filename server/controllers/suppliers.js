const { simpleResource } = require('./simpleResource');
const { text, email } = require('../lib/validate');

module.exports = simpleResource({
  table: 'suppliers',
  label: 'Supplier',
  parse: (body) => ({
    name: text(body.name, 'Name', { required: true, max: 150 }),
    contact_name: text(body.contact_name, 'Contact name', { max: 150 }),
    phone: text(body.phone, 'Phone', { max: 40 }),
    email: email(body.email),
    address: text(body.address, 'Address', { max: 500 }),
    notes: text(body.notes, 'Notes', { max: 2000 }),
  }),
});
