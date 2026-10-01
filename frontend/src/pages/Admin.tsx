import { useState, useEffect } from "react";
import { Navbar } from "@/components/Navbar";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";
import { 
  Users, Building, Loader2 
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { useNavigate } from "react-router-dom";
import { 
  adminCreateTenant, adminListTenants, adminListMembers, 
  adminUpdateMemberRole
} from "@/lib/api";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PermissionGate } from "@/components/auth/PermissionGate";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

interface PendingManagerChange {
  memberId: string;
  overrideRole: string | null;
  currentManagerId: string;
}

export default function AdminPage() {
  const { user, loading: authLoading, roleResolved } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  
  const [tenants, setTenants] = useState<any[]>([]);
  const [members, setMembers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<string | null>(null);

  // Form states
  const [newTenantName, setNewTenantName] = useState("");
  const [newTenantAdminEmail, setNewTenantAdminEmail] = useState("");
  
  // Manager assignment state
  const [pendingManagerChange, setPendingManagerChange] = useState<PendingManagerChange | null>(null);
  const [selectedManagerId, setSelectedManagerId] = useState("");

  // Set initial tab once user is loaded and role is resolved
  useEffect(() => {
    if (!authLoading && roleResolved && user && activeTab === null) {
      setActiveTab(user.role === 'super_admin' ? "tenants" : "members");
    }
  }, [user, authLoading, roleResolved, activeTab]);

  useEffect(() => {
    if (!authLoading && roleResolved && user && (user.role === 'recruiter' || user.role === 'manager')) {
      navigate("/dashboard");
    }
  }, [user, authLoading, roleResolved, navigate]);

  useEffect(() => {
    if (user && roleResolved && activeTab) {
      loadData();
    }
  }, [user, roleResolved, activeTab]);

  useEffect(() => {
    if (pendingManagerChange) {
      setSelectedManagerId(pendingManagerChange.currentManagerId);
    }
  }, [pendingManagerChange]);

  const loadData = async () => {
    setLoading(true);
    try {
      if (activeTab === "tenants" && user?.role === 'super_admin') {
        const data = await adminListTenants();
        setTenants(data || []);
      } else if (activeTab === "members") {
        const data = await adminListMembers(user?.tenant_id);
        setMembers(data || []);
      }
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleCreateTenant = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await adminCreateTenant(newTenantName, newTenantAdminEmail);
      toast({ title: "Success", description: "Tenant created successfully" });
      setNewTenantName("");
      setNewTenantAdminEmail("");
      loadData();
    } catch (err: any) {
      toast({ title: "Failed to create tenant", description: err.message, variant: "destructive" });
    }
  };

  if (authLoading || !roleResolved || (user && !activeTab)) return <div className="h-screen flex items-center justify-center"><Loader2 className="animate-spin" /></div>;

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="container mx-auto px-4 pt-24 pb-16">
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight">Administration</h1>
          <p className="text-muted-foreground mt-1">Manage your {user?.role === 'super_admin' ? 'platform' : 'tenant'} settings and team</p>
        </motion.div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          {/* Only show the tab switcher when there is more than one tab to switch between */}
          {user?.role === 'super_admin' && (
            <TabsList className="bg-background border border-border/50 p-1 shadow-sm rounded-md">
              <TabsTrigger value="tenants" className="gap-2 data-[state=active]:!bg-blue-600 data-[state=active]:!text-white rounded-md transition-colors">
                <Building className="h-4 w-4" /> Tenants
              </TabsTrigger>
            </TabsList>
          )}
          {user?.role !== 'super_admin' && (
            <PermissionGate permission="create_tenant">
              <TabsList className="bg-background border border-border/50 p-1 shadow-sm rounded-md">
                <TabsTrigger value="members" className="gap-2 data-[state=active]:!bg-blue-600 data-[state=active]:!text-white rounded-md transition-colors">
                  <Users className="h-4 w-4" /> Team Members
                </TabsTrigger>
                <TabsTrigger value="tenants" className="gap-2 data-[state=active]:!bg-blue-600 data-[state=active]:!text-white rounded-md transition-colors">
                  <Building className="h-4 w-4" /> Tenants
                </TabsTrigger>
              </TabsList>
            </PermissionGate>
          )}

          {/* TEAM MEMBERS TAB */}
          <TabsContent value="members" className="space-y-6">
            <div className="card-elevated border border-border/50 rounded-md overflow-hidden">
              <div className="p-4 border-b border-border/50 flex justify-between items-center">
                 <h3 className="font-semibold">Current Members</h3>
                 <span className="text-xs text-white font-semibold bg-blue-600 px-2 py-1 rounded-md">{members.length} Total</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-secondary/30">
                    <tr>
                      <th className="text-left text-[10px] uppercase tracking-wider px-4 py-3 font-bold text-muted-foreground">User</th>
                      <th className="text-left text-[10px] uppercase tracking-wider px-4 py-3 font-bold text-muted-foreground">AI Interview Access</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/30">
                    {loading ? (
                       <tr><td colSpan={2} className="text-center py-8"><Loader2 className="animate-spin mx-auto h-5 w-5 opacity-20" /></td></tr>
                    ) : members.length === 0 ? (
                      <tr><td colSpan={2} className="text-center py-8 text-muted-foreground text-sm">No members found</td></tr>
                    ) : (
                      members.map(m => (
                        <tr key={m.id} className="hover:bg-secondary/20 transition-colors">
                          <td className="px-4 py-3">
                            <div className="flex flex-col">
                              <span className="text-sm font-medium">{m.user_email}</span>
                              <span className="text-[10px] text-muted-foreground font-mono">ID: {m.user_id.substring(0,8)}</span>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex flex-col gap-1">
                              <select
                                value={m.override_role || ""}
                                disabled={m.role === "admin"}
                                onChange={async (e) => {
                                  const val = e.target.value;
                                  const targetRole = val === "" ? null : val;
                                  
                                  const rawRole = (m.scaloz_role || "").toLowerCase();
                                  const isScalozAdmin = rawRole.includes("admin") || rawRole.includes("subadmin") || rawRole.includes("sub admin");
                                  const isScalozManager = rawRole.includes("manager") || rawRole.includes("manger") || rawRole.includes("program manager");
                                  const fallbackRole = isScalozAdmin ? 'admin' : (isScalozManager ? 'manager' : 'recruiter');
                                  const newResolvedRole = targetRole || fallbackRole;
                                  
                                  if (newResolvedRole === 'recruiter') {
                                    setPendingManagerChange({
                                      memberId: m.id,
                                      overrideRole: targetRole,
                                      currentManagerId: m.manager_id || ""
                                    });
                                  } else {
                                    try {
                                      await adminUpdateMemberRole(m.id, targetRole, null);
                                      toast({ title: "Success", description: "AI Interview access role override updated successfully" });
                                      loadData();
                                    } catch (err: any) {
                                      toast({ title: "Error", description: err.message, variant: "destructive" });
                                    }
                                  }
                                }}
                                className="h-9 rounded-md bg-background border border-border/50 px-3 text-sm focus:outline-none focus:ring-1 focus:ring-primary/50 cursor-pointer appearance-none bg-no-repeat bg-[url('data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2224%22%20height%3D%2224%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22currentColor%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Cpolyline%20points%3D%226%209%2012%2015%2018%209%22%3E%3C%2Fpolyline%3E%3C%2Fsvg%3E')] bg-[position:calc(100%_-_10px)_center] bg-[size:16px_16px] pr-10 min-w-[180px] w-fit disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                <option value="">Default Mapping ({m.role})</option>
                                {m.role === 'admin' && <option value="admin">Admin</option>}
                                <option value="manager">Manager</option>
                                <option value="recruiter">Recruiter</option>
                              </select>
                              {m.role === 'recruiter' && (
                                <div className="text-[11px] text-muted-foreground flex items-center gap-1.5 mt-0.5 select-none">
                                  <span>Manager: <strong className="text-foreground">{m.manager_email || "None"}</strong></span>
                                  <button
                                    onClick={() => setPendingManagerChange({
                                      memberId: m.id,
                                      overrideRole: m.override_role,
                                      currentManagerId: m.manager_id || ""
                                    })}
                                    className="text-primary hover:underline text-[10px] uppercase font-bold tracking-tighter"
                                  >
                                    Change
                                  </button>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </TabsContent>

          {/* TENANTS TAB (SUPER ADMIN ONLY) */}
          <PermissionGate permission="create_tenant">
            <TabsContent value="tenants" className="space-y-6">
              <div className="grid md:grid-cols-3 gap-6">
                <div className="md:col-span-2 card-elevated border border-border/50 rounded-md overflow-hidden">
                  <div className="p-4 border-b border-border/50 flex justify-between items-center bg-secondary/10">
                    <h3 className="font-semibold">Active Tenants</h3>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="bg-secondary/30">
                          <th className="text-left text-[10px] uppercase px-4 py-3 font-bold text-muted-foreground">Name</th>
                          <th className="text-left text-[10px] uppercase px-4 py-3 font-bold text-muted-foreground">ID</th>
                          <th className="text-left text-[10px] uppercase px-4 py-3 font-bold text-muted-foreground">Plan</th>
                          <th className="text-right text-[10px] uppercase px-4 py-3 font-bold text-muted-foreground">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/30">
                        {loading ? (
                           <tr><td colSpan={4} className="text-center py-8"><Loader2 className="animate-spin mx-auto h-5 w-5" /></td></tr>
                        ) : tenants.map(t => (
                          <tr key={t.id} className="hover:bg-secondary/20 transition-colors">
                            <td className="px-4 py-3 font-medium text-sm">{t.name}</td>
                            <td className="px-4 py-3 text-[10px] font-mono text-muted-foreground">{t.id}</td>
                            <td className="px-4 py-3 text-xs uppercase font-bold tracking-tighter text-primary">{t.plan}</td>
                            <td className="px-4 py-3 text-right">
                               <span className="h-2 w-2 rounded-full bg-success inline-block mr-2" />
                               <span className="text-xs">Active</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="card-elevated border border-border/50 rounded-md p-6 bg-secondary/20 h-fit">
                  <h3 className="font-semibold mb-4 flex items-center gap-2">
                    <Building className="h-4 w-4 text-primary" /> Create New Tenant
                  </h3>
                  <form onSubmit={handleCreateTenant} className="space-y-4">
                    <div className="space-y-2">
                      <label className="text-xs font-medium text-muted-foreground">Organization Name</label>
                      <input 
                        required
                        value={newTenantName}
                        onChange={e => setNewTenantName(e.target.value)}
                        placeholder="Acme Corp"
                        className="w-full h-10 rounded-md bg-background border border-border/50 px-3 text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-medium text-muted-foreground">Admin Email (Optional)</label>
                      <input 
                        type="email"
                        value={newTenantAdminEmail}
                        onChange={e => setNewTenantAdminEmail(e.target.value)}
                        placeholder="admin@tenant.com"
                        className="w-full h-10 rounded-md bg-background border border-border/50 px-3 text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
                      />
                    </div>
                    <Button type="submit" variant="hero" className="w-full">
                       Create Tenant
                    </Button>
                  </form>
                </div>
              </div>
            </TabsContent>
          </PermissionGate>
        </Tabs>
      </div>

      {/* Reporting Manager Assignment Dialog */}
      {pendingManagerChange && (
        <Dialog open={true} onOpenChange={() => setPendingManagerChange(null)}>
          <DialogContent className="sm:max-w-[425px] bg-card border border-border/50 rounded-md p-8 shadow-2xl">
            <DialogHeader className="mb-6">
              <DialogTitle className="text-xl font-bold flex items-center gap-2">
                Assign Reporting Manager
              </DialogTitle>
              <DialogDescription className="text-muted-foreground text-xs mt-1">
                Recruiters report to a designated Manager. Please select a manager.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <label className="text-xs font-semibold text-muted-foreground">Manager</label>
                <select
                  value={selectedManagerId}
                  onChange={(e) => setSelectedManagerId(e.target.value)}
                  className="w-full h-10 rounded-md bg-background border border-border/50 px-3 text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
                >
                  <option value="">No Manager (Unassigned)</option>
                  {members
                    .filter(m => m.role === 'manager')
                    .map(m => (
                      <option key={m.user_id} value={m.user_id}>
                        {m.user_email}
                      </option>
                    ))
                  }
                </select>
              </div>
            </div>

            <DialogFooter className="flex gap-2 mt-6">
              <Button variant="outline" className="flex-1" onClick={() => setPendingManagerChange(null)}>
                Cancel
              </Button>
              <Button
                variant="hero"
                className="flex-1"
                onClick={async () => {
                  try {
                    await adminUpdateMemberRole(
                      pendingManagerChange.memberId,
                      pendingManagerChange.overrideRole,
                      selectedManagerId || null
                    );
                    toast({ title: "Success", description: "Access role and reporting manager updated successfully" });
                    setPendingManagerChange(null);
                    loadData();
                  } catch (err: any) {
                    toast({ title: "Error", description: err.message, variant: "destructive" });
                  }
                }}
              >
                Save
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
