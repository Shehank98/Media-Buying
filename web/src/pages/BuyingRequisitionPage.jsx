import { useAuth } from '../contexts/AuthContext';
import RequisitionsPanel from '../components/RequisitionsPanel';

// Buying Requisition - the Media Buying Requisition (MBR) workspace, its own
// top-level page (it used to live as a sub-tab of Media Packages). Everyone who
// can reach it gets the request form; SUPER_ADMIN also sees every submitted
// requisition, not just their own.
export default function BuyingRequisitionPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'SUPER_ADMIN';

  return (
    <div className="content-narrow fade-in">
      <div className="page-head">
        <div>
          <h1 className="page-title">Buying Requisition</h1>
          <p className="page-sub">
            {isAdmin
              ? 'Raise a media buying requisition and review every MBR submitted to the buying unit.'
              : 'Request a media plan from the buying unit and track the requisitions you have raised.'}
          </p>
        </div>
      </div>

      <RequisitionsPanel />
    </div>
  );
}
