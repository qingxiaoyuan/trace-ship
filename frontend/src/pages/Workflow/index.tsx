import { useState } from 'react';
import { TsCard } from '@/components/TsCard';
import { TabHeader } from './components/TabHeader';
import { TodoTab } from './components/TodoTab';
import { DoneTab } from './components/DoneTab';
import type { TabKey } from './constants';

export default function Workflow() {
  const [activeTab, setActiveTab] = useState<TabKey>('todo');

  return (
    <div className="space-y-5 ts-fade-in-up">
      <TsCard bodyStyle={{ padding: 0 }}>
        <TabHeader active={activeTab} onChange={setActiveTab} />
        <div className="p-5">
          {activeTab === 'todo' && <TodoTab />}
          {activeTab === 'done' && <DoneTab />}
        </div>
      </TsCard>
    </div>
  );
}
