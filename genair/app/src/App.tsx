import { lazy, Suspense, type ReactNode } from 'react'
import { HashRouter, Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import { Toaster } from './components/ui'
import { RoleGate } from './components/RoleGate'
import { useApp } from './lib/store'
import { AuthGate } from './features/auth/AuthGate'
import { DemoPlayer } from './features/demo/DemoPlayer'

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
          <Route path="cases" element={<S><CasesPage /></S>} />
          <Route path="cases/new" element={<S><NewCase /></S>} />
          <Route path="cases/:id" element={<S><CasePage /></S>} />
          <Route path="quotes/:id" element={<S><QuoteEditor /></S>} />
          <Route path="customers" element={<S><CustomersPage /></S>} />
          <Route path="customers/:id" element={<S><CustomerPage /></S>} />
          <Route path="calendar" element={<S><CalendarPage /></S>} />
          <Route path="field" element={<S><FieldApp /></S>} />
          <Route path="field/:id" element={<S><FieldJob /></S>} />
          <Route path="service" element={<S><ServicePage /></S>} />
          <Route path="service/:id" element={<S><ServiceCallPage /></S>} />
          <Route path="contracts" element={<S><ContractsPage /></S>} />
          <Route path="projects" element={<RoleGate roles={['admin', 'office', 'agent', 'engineer']}><S><ProjectsPage /></S></RoleGate>} />
          <Route path="projects/:id" element={<RoleGate roles={['admin', 'office', 'agent', 'engineer']}><S><ProjectPage /></S></RoleGate>} />
          <Route path="inventory" element={<S><InventoryPage /></S>} />
          <Route path="reports" element={<RoleGate roles={['admin', 'office']}><S><ReportsPage /></S></RoleGate>} />
          <Route path="settings" element={<RoleGate roles={['admin', 'office']}><S><SettingsPage /></S></RoleGate>} />
          <Route path="settings/priority" element={<RoleGate roles={['admin', 'office']}><S><PrioritySync /></S></RoleGate>} />
          <Route path="tasks" element={<S><TasksPage /></S>} />
          <Route path="leave" element={<S><LeavePage /></S>} />
          <Route path="suppliers" element={<RoleGate roles={['admin', 'office', 'engineer']}><S><SuppliersPage /></S></RoleGate>} />
          <Route path="suppliers/:id" element={<RoleGate roles={['admin', 'office', 'engineer']}><S><SupplierPage /></S></RoleGate>} />
          <Route path="users" element={<RoleGate roles={['admin', 'office']}><S><UsersPage /></S></RoleGate>} />
          <Route path="*" element={<div className="empty">העמוד לא נמצא</div>} />
        </Route>
      </Routes>
      <Toaster />
      <DemoPlayer />
    </HashRouter>
  )
}
