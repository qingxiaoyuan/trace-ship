import { useState } from 'react';
import { StatCards } from './components/StatCards';
import { ApprovalListView } from './components/ApprovalListView';
import { ApprovalDetailView } from './components/ApprovalDetailView';
import type { DetailSource, ViewMode } from './types';

export default function Workflow() {
  const [view, setView] = useState<ViewMode>('list');
  const [detail, setDetail] = useState<DetailSource | null>(null);

  const openDetail = (src: DetailSource) => {
    setDetail(src);
    setView('detail');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const backToList = () => {
    setView('list');
    setDetail(null);
  };

  return (
    <div className="space-y-5 ts-fade-in-up">
      {view === 'list' ? (
        <>
          <StatCards />
          <ApprovalListView onOpenDetail={openDetail} />
        </>
      ) : (
        detail && <ApprovalDetailView source={detail} onBack={backToList} />
      )}
    </div>
  );
}
