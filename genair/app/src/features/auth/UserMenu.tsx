// המשתמש המחובר בתחתית התפריט
import { useMe } from '../../lib/store'
import { Avatar } from '../../components/ui'

export function UserMenu() {
  const me = useMe()
  return (
    <>
      <div className="row" style={{ marginBottom: 10 }}>
        <Avatar user={me} />
        <div className="grow">
          <div style={{ color: '#fff', fontWeight: 600 }}>{me.name}</div>
          <div className="tiny">{me.title}</div>
        </div>
      </div>
      <span className="demo-badge">גרסת הדגמה</span>
    </>
  )
}
