import { useSearchParams } from 'react-router-dom';
import { PageHeader, Tabs, TabPanel } from '../components/ui';
import { IntakeContent } from './Intake';
import { PlansContent } from './Plans';

const TABS = [
  { id: 'inbox', label: 'Входящие' },
  { id: 'plans', label: 'Планы' },
];

function Reception() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'plans' ? 'plans' : 'inbox';

  return (
    <div style={{ maxWidth: 820, margin: '0 auto' }}>
      <PageHeader title="Приёмная" subtitle="Входящие задачи и планы на подпись" />
      <Tabs
        tabs={TABS}
        active={tab}
        onChange={(id) => setParams(id === 'inbox' ? {} : { tab: id }, { replace: true })}
      />
      <TabPanel id="inbox" active={tab === 'inbox'}><IntakeContent /></TabPanel>
      <TabPanel id="plans" active={tab === 'plans'}><PlansContent /></TabPanel>
    </div>
  );
}

export default Reception;
