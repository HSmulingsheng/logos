import { Segmented } from '../components/ui'
import { Books } from './Books'
import { Browse } from './Browse'

export type LibraryView = 'books' | 'browse'

/** 「词书」与「词典」合并后的容器 */
export function Library({
  view, setView, onStudy,
}: {
  view: LibraryView
  setView: (v: LibraryView) => void
  onStudy: () => void
}) {
  return (
    <div className="animate-fade-up">
      <Segmented<LibraryView>
        value={view}
        onChange={setView}
        options={[
          { value: 'books', label: '词书' },
          { value: 'browse', label: '词典' },
        ]}
      />
      {view === 'books' ? <Books onStudy={onStudy} embedded /> : <Browse embedded />}
    </div>
  )
}
