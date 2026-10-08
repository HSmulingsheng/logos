import { Segmented } from '../components/ui'
import { Stats } from './Stats'
import { SettingsPage } from './Settings'

export type MineView = 'stats' | 'settings'

/** 「统计」并入「我的」后的容器 */
export function Mine({
  view, setView,
}: {
  view: MineView
  setView: (v: MineView) => void
}) {
  return (
    <div className="animate-fade-up">
      <Segmented<MineView>
        value={view}
        onChange={setView}
        options={[
          { value: 'stats', label: '学习统计' },
          { value: 'settings', label: '设置' },
        ]}
      />
      {view === 'stats' ? <Stats embedded /> : <SettingsPage embedded />}
    </div>
  )
}
