import { Route, Routes } from 'react-router-dom'
import { AuthProvider } from '@/lib/auth.tsx'
import AdminPage from '@/pages/admin-page.tsx'
import DebugPage from '@/pages/debug-page.tsx'
import ErpPage from '@/pages/erp-page.tsx'
import HomePage from '@/pages/home-page.tsx'
import LeadLensPage from '@/pages/leadlens-page.tsx'
import SalesGraphPage from '@/pages/sales-graph-page.tsx'
import SeoPage from '@/pages/seo-page.tsx'

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/TeleCallerAudit/*" element={<LeadLensPage />} />
        <Route path="/SalesGraph/*" element={<SalesGraphPage />} />
        <Route path="/ERPSync/*" element={<ErpPage />} />
        <Route path="/SEO/*" element={<SeoPage />} />
        <Route path="/admin/*" element={<AdminPage />} />
        <Route path="/DeBugMode/*" element={<DebugPage />} />
        <Route path="*" element={<HomePage />} />
      </Routes>
    </AuthProvider>
  )
}
