import { Database } from 'lucide-react';
import { PageHeader, Empty } from '../components/ui';

// Placeholder until the database console is built.
export default function DatabasePage() {
  return (
    <div>
      <PageHeader title="Database" subtitle="Tables, schema, queries and backups." icon={Database} eyebrow="System" />
      <Empty icon={Database} title="Coming together" message="The database console is being built." />
    </div>
  );
}
