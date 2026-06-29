import { Typography, Tag, Divider } from 'antd';
import { blueColors } from '../constants';
import type { PreviewPanelProps } from '../types';

const { Text } = Typography;

/** 实时预览面板：展示版本号、Git 哈希、更新内容与关联性改动 */
export function PreviewPanel({
  version,
  gitHash,
  updates,
  relatedChanges,
}: PreviewPanelProps) {
  const visibleRelated = relatedChanges.filter((r) => r.version.trim());
  const versionText = version || '—';
  const hashText = gitHash ? `${gitHash.slice(0, 8)}...${gitHash.slice(-8)}` : '—';

  return (
    <div style={{ color: blueColors.charcoal, lineHeight: 1.7 }}>
      <div style={{ marginBottom: 16 }}>
        <Text style={{ color: blueColors.muted, fontSize: 12 }}>版本</Text>
        <div style={{ fontWeight: 700, fontSize: 18, fontFamily: 'monospace' }}>{versionText}</div>
      </div>
      <div style={{ marginBottom: 20 }}>
        <Text style={{ color: blueColors.muted, fontSize: 12 }}>Git 哈希</Text>
        <div style={{ fontFamily: 'monospace', fontSize: 13 }}>{hashText}</div>
      </div>

      <Divider style={{ borderColor: blueColors.border }} />

      <div style={{ marginBottom: 20 }}>
        <Text style={{ fontWeight: 600, display: 'block', marginBottom: 8 }}>更新内容</Text>
        {updates.map((u) =>
          u.content ? (
            <div key={u.id} style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
              <Tag
                style={{
                  background: u.type === 'A' ? blueColors.paleBlue.bg : blueColors.paleYellow.bg,
                  color: u.type === 'A' ? blueColors.paleBlue.text : blueColors.paleYellow.text,
                  border: 'none',
                  borderRadius: 9999,
                  fontWeight: 600,
                }}
              >
                {u.type}类
              </Tag>
              <Text style={{ fontSize: 13 }}>{u.content}</Text>
            </div>
          ) : null
        )}
      </div>

      {visibleRelated.length > 0 && (
        <>
          <Divider style={{ borderColor: blueColors.border }} />
          <div>
            <Text style={{ fontWeight: 600, display: 'block', marginBottom: 8 }}>关联性改动</Text>
            {visibleRelated.map((r) => (
              <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 13 }}>
                <Text style={{ color: blueColors.muted }}>{r.softwareName}</Text>
                <Text style={{ fontFamily: 'monospace' }}>{r.version}</Text>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
