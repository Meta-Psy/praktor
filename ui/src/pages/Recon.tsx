import { useSearchParams } from 'react-router-dom';
import { PageHeader, Tabs } from '../components/ui';
import { RadarContent } from './Radar';
import { IntelContent } from './Intel';

const TABS = [
  { id: 'radar', label: 'Радар' },
  { id: 'intel', label: 'Сводки' },
];

function Recon() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'intel' ? 'intel' : 'radar';

  return (
    <div style={{ maxWidth: 820, margin: '0 auto' }}>
      <PageHeader title="Разведка" subtitle="Радар экосистемы и разведсводки по источникам" />
      <Tabs
        tabs={TABS}
        active={tab}
        onChange={(id) => setParams(id === 'radar' ? {} : { tab: id }, { replace: true })}
      />
      {tab === 'radar' ? <RadarContent /> : <IntelContent />}
    </div>
  );
}

export default Recon;
