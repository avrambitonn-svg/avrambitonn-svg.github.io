import { lazy, Suspense, type ReactNode } from 'react'
import { HashRouter, Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import { Toaster } from './components/ui'
import { useApp } from './lib/store'
import { AuthGate } from './features/auth/AuthGate'
import { DemoPlayer } from './features/demo/DemoPlayer'
import { RequireRole } from './components/RequireRole'
import { routeRoles } from './lib/access'

const Dashboard = lazy(() => import('./pages/Dashboard'))
const CasesPage = lazy(() => import('./pages/cases/CasesPage'))
const NewCase = lazy(() => import('./pages/cases/NewCase'))
const CasePage = lazy(() => import('./pages/cases/CasePage'))
const QuoteEditor = lazy(() => import('./pages/quotes/QuoteEditor'))
const QuotePrint = lazy(() => import('./pages/quotes/QuotePrint'))
const Portal = lazy(() => import('./pages/portal/Portal'))
const RequestForm = lazy(() => import('./pages/portal/RequestForm'))
const CustomersPage = lazy(() => import('./pages/customers/CustomersPage'))
const CustomerPage = lazy(() => import('./pages/customers/CustomerPage'))
const CalendarPage = lazy(() => import('./pages/calendar/CalendarPage'))
const FieldApp = lazy(() => import('./pages/field/FieldApp'))
const FieldJob = lazy(() => import('./pages/field/FieldJob'))
const ServicePage = lazy(() => import('./pages/service/ServicePage'))
const ServiceCallPage = lazy(() => import('./pages/service/ServiceCallPage'))
const ContractsPage = lazy(() => import('./pages/contracts/ContractsPage'))
const ProjectsPage = lazy(() => import('./pages/projects/ProjectsPage'))
const ProjectPage = lazy(() => import('./pages/projects/ProjectPage'))
const InventoryPage = lazy(() => import('./pages/inventory/InventoryPage'))
const ReportsPage = lazy(() => import('./pages/reports/ReportsPage'))
const SettingsPage = lazy(() => import('./pages/settings/SettingsPage'))
const PrioritySync = lazy(() => import('./pages/settings/PrioritySync'))
const TasksPage = lazy(() => import('./pages/tasks/TasksPage'))
const LeavePage = lazy(() => import('./pages/leave/LeavePage'))
const SuppliersPage = lazy(() => import('./pages/suppliers/SuppliersPage'))
const SupplierPage = lazy(() => import('./pages/suppliers/SupplierPage'))
const UsersPage = lazy(() => import('./pages/users/UsersPage'))

const Loading = () => <div className="empty">טוען...</div>
const S = ({ children }: { children: ReactNode }) => <Suspense fallback={<Loading />}>{children}</Suspense>
// מסך שמוגבל לתפקידים (כמו בתפריט): routeRoles ב-lib/access.ts
const G = ({ r, children }: { r: keyof typeof routeRoles; children: ReactNode }) => <RequireRole roles={routeRoles[r]}><S>{children}</S></RequireRole>

export default function App() {
  const hydrated = useApp((s) => s.hydrated)
  if (!hydrated) return <Loading />
  return (
    <HashRouter>
      <Routes>
        {/* מסכים ללקוחות, בלי תפריט המערכת */}
        <Route path="/portal/:token" element={<S><Portal /></S>} />
        <Route path="/request" element={<S><RequestForm /></S>} />
        <Route path="/quotes/:id/print" element={<S><QuotePrint /></S>} />

        <Route element={<AuthGate><Layout /></AuthGate>}>
          <Route index element={<S><Dashboard /></S>} />
          <Route path="cases" element={<G r="cases"><CasesPage /></G>} />
          <Route path="cases/new" element={<G r="cases"><NewCase /></G>} />
          <Route path="cases/:id" element={<S><CasePage /></S>} />
          <Route path="quotes/:id" element={<G r="quotes"><QuoteEditor /></G>} />
          <Route path="customers" element={<G r="customers"><CustomersPage /></G>} />
          <Route path="customers/:id" element={<S><CustomerPage /></S>} />
          <Route path="calendar" element={<S><CalendarPage /></S>} />
          <Route path="field" element={<S><FieldApp /></S>} />
          <Route path="field/:id" element={<S><FieldJob /></S>} />
          <Route path="service" element={<S><ServicePage /></S>} />
          <Route path="service/:id" element={<S><ServiceCallPage /></S>} />
          <Route path="contracts" element={<G r="contracts"><ContractsPage /></G>} />
          <Route path="projects" element={<G r="projects"><ProjectsPage /></G>} />
          <Route path="projects/:id" element={<G r="projects"><ProjectPage /></G>} />
          <Route path="inventory" element={<G r="inventory"><InventoryPage /></G>} />
          <Route path="reports" element={<G r="reports"><ReportsPage /></G>} />
          <Route path="settings" element={<G r="settings"><SettingsPage /></G>} />
          <Route path="settings/priority" element={<G r="settings"><PrioritySync /></G>} />
          <Route path="tasks" element={<S><TasksPage /></S>} />
          <Route path="leave" element={<S><LeavePage /></S>} />
          <Route path="suppliers" element={<G r="suppliers"><SuppliersPage /></G>} />
          <Route path="suppliers/:id" element={<G r="suppliers"><SupplierPage /></G>} />
          <Route path="users" element={<G r="users"><UsersPage /></G>} />
          <Route path="*" element={<div className="empty">העמוד לא נמצא</div>} />
        </Route>
      </Routes>
      <Toaster />
      <DemoPlayer />
    </HashRouter>
  )
}
