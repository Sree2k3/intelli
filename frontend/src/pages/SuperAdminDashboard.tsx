import { useState, useEffect } from "react";
import { Navbar } from "@/components/Navbar";
import { useAuth } from "@/hooks/useAuth";
import { motion, AnimatePresence } from "framer-motion";
import { 
  Building, Users, FileText, CheckCircle2, 
  Search, Filter, Trash2, Edit3, ShieldAlert, CreditCard,
  AlertCircle, Calendar, ShieldCheck, Plus, Eye, Loader2,
  Phone, Mail, User, Info, Building2
} from "lucide-react";
import { 
  getSuperAdminStats, 
  getSuperAdminTenants,
  createSuperAdminTenant,
  getSuperAdminTenantDetails,
  updateSuperAdminTenant,
  deleteSuperAdminTenant
} from "@/lib/api";
import { SkeletonCard, SkeletonRow } from "@/components/admin/Skeletons";
import { EmptyState } from "@/components/admin/EmptyState";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { 
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export default function SuperAdminDashboard() {
  const { user, loading: authLoading, redirectToScalozLogin } = useAuth();
  const { toast } = useToast();
  const [stats, setStats] = useState<any>(null);
  const [tenants, setTenants] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  
  // Modal states
  const [isNewOpen, setIsNewOpen] = useState(false);
  const [isViewOpen, setIsViewOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  
  // Action states
  const [selectedTenant, setSelectedTenant] = useState<any>(null);
  const [tenantDetails, setTenantDetails] = useState<any>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDetailLoading, setIsDetailLoading] = useState(false);

  // Form states
  const [formData, setFormData] = useState({
    name: "",
    admin_name: "",
    admin_email: "",
    password: "",
    company_name: "",
    plan_type: "basic",
    duration_days: "30",
    start_date: new Date().toISOString().split('T')[0],
    expiry_date: "",
    status: "active",
    interview_limit: "100",
    phone: "",
    notes: ""
  });

  useEffect(() => {
    if (!authLoading && user) {
      if (user.role !== 'super_admin') {
        window.location.href = '/admin/dashboard';
      } else {
        loadData();
      }
    }
  }, [user, authLoading]);

  // Calculate expiry date automatically
  useEffect(() => {
    if (formData.start_date && formData.duration_days) {
      const start = new Date(formData.start_date);
      const days = parseInt(formData.duration_days);
      const expiry = new Date(start);
      expiry.setDate(start.getDate() + days);
      setFormData(prev => ({ ...prev, expiry_date: expiry.toISOString().split('T')[0] }));
    }
  }, [formData.start_date, formData.duration_days]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [s, t] = await Promise.all([
        getSuperAdminStats(),
        getSuperAdminTenants()
      ]);
      setStats(s);
      setTenants(t);
    } catch (err: any) {
      toast({ title: "Error", description: "Failed to load platform data", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleCreateTenant = async () => {
    setIsSubmitting(true);
    try {
      await createSuperAdminTenant({
        ...formData,
        duration_days: parseInt(formData.duration_days),
        interview_limit: parseInt(formData.interview_limit)
      });
      toast({ title: "Success", description: "Tenant workspace created successfully" });
      setIsNewOpen(false);
      resetForm();
      loadData();
    } catch (err: any) {
      toast({ title: "Error", description: err.message || "Failed to create tenant", variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleViewTenant = async (tenantId: string) => {
    setSelectedTenant(tenants.find(t => t.id === tenantId));
    setIsViewOpen(true);
    setIsDetailLoading(true);
    try {
      const details = await getSuperAdminTenantDetails(tenantId);
      setTenantDetails(details);
    } catch (err: any) {
      toast({ title: "Error", description: "Failed to load tenant details" });
    } finally {
      setIsDetailLoading(false);
    }
  };

  const handleOpenEdit = async (tenantId: string) => {
    setIsEditOpen(true);
    setIsDetailLoading(true);
    try {
      const details = await getSuperAdminTenantDetails(tenantId);
      setTenantDetails(details);
      setFormData({
        name: details.name,
        admin_name: details.admin_name,
        admin_email: details.admin_email,
        password: "", // Don't show password
        company_name: details.company_name,
        plan_type: details.plan_type,
        duration_days: details.duration_days.toString(),
        start_date: details.start_date.split('T')[0],
        expiry_date: details.expiry_date.split('T')[0],
        status: details.status,
        interview_limit: details.interview_limit.toString(),
        phone: details.phone,
        notes: details.notes
      });
    } catch (err: any) {
      toast({ title: "Error", description: "Failed to load tenant for editing" });
    } finally {
      setIsDetailLoading(false);
    }
  };

  const handleUpdateTenant = async () => {
    if (!tenantDetails) return;
    setIsSubmitting(true);
    try {
      await updateSuperAdminTenant(tenantDetails.id, {
        name: formData.name,
        admin_email: formData.admin_email,
        plan_type: formData.plan_type,
        duration_days: parseInt(formData.duration_days),
        expiry_date: formData.expiry_date,
        status: formData.status,
        interview_limit: parseInt(formData.interview_limit),
        phone: formData.phone,
        notes: formData.notes
      });
      toast({ title: "Success", description: "Tenant updated successfully" });
      setIsEditOpen(false);
      loadData();
    } catch (err: any) {
      toast({ title: "Error", description: err.message || "Failed to update tenant", variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedTenant) return;
    setIsSubmitting(true);
    try {
      await deleteSuperAdminTenant(selectedTenant.id);
      toast({ title: "Success", description: "Tenant removed permanently" });
      setIsDeleteOpen(false);
      loadData();
    } catch (err: any) {
      toast({ title: "Error", description: "Failed to delete tenant", variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };

  const resetForm = () => {
    setFormData({
      name: "",
      admin_name: "",
      admin_email: "",
      password: "",
      company_name: "",
      plan_type: "basic",
      duration_days: "30",
      start_date: new Date().toISOString().split('T')[0],
      expiry_date: "",
      status: "active",
      interview_limit: "100",
      phone: "",
      notes: ""
    });
  };

  const filteredTenants = tenants.filter(t => 
    t.name.toLowerCase().includes(search.toLowerCase()) ||
    t.admin_email.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-background text-foreground selection:bg-primary/30">
      <Navbar />
      
      <main className="container mx-auto px-4 pt-28 pb-16">
        <header className="mb-8 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex-1">
            <h1 className="text-4xl font-semibold tracking-tight flex items-center gap-4 text-foreground">
              Super Admin Dashboard
            </h1>
            <p className="text-muted-foreground font-medium mt-1">Platform-wide oversight and tenant management infrastructure</p>
          </div>
          
          <div className="flex items-center gap-4">
             <Button 
               variant="hero" 
               onClick={() => { resetForm(); setIsNewOpen(true); }}
               className="rounded-md h-12 px-8 font-semibold gap-2 bg-primary text-black hover:bg-[#00B8E6] shadow-lg shadow-primary/20"
             >
               <Plus size={20} strokeWidth={3} /> New Tenant
             </Button>
          </div>
        </header>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
          {loading ? (
            Array(5).fill(0).map((_, i) => <SkeletonCard key={i} />)
          ) : (
            <>
               <div className="card-elevated p-6 border border-primary/20 rounded-md bg-card relative group min-h-[160px] flex flex-col justify-between">
                  <div className="flex items-center justify-between">
                     <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                        <Building size={20} />
                     </div>
                     <span className="text-[10px] font-semibold tracking-widest text-primary uppercase">Active</span>
                  </div>
                  <div className="mt-4">
                     <p className="text-4xl font-semibold tracking-tight">{stats?.total_tenants || 0}</p>
                     <p className="text-xs text-black mt-1 tracking-wider">Total tenants</p>
                  </div>
               </div>

               <div className="card-elevated p-6 border border-border/50 rounded-md bg-card relative group min-h-[160px] flex flex-col justify-between">
                  <div className="h-10 w-10 rounded-full bg-blue-500/10 flex items-center justify-center text-blue-400">
                     <FileText size={20} />
                  </div>
                  <div className="mt-4">
                     <p className="text-4xl font-semibold tracking-tight">{stats?.total_interviews || 0}</p>
                     <p className="text-xs text-black mt-1 tracking-wider">Interviews</p>
                  </div>
               </div>

               <div className="card-elevated p-6 border border-border/50 rounded-md bg-card relative group min-h-[160px] flex flex-col justify-between">
                  <div className="h-10 w-10 rounded-full bg-success/10 flex items-center justify-center text-success">
                     <CheckCircle2 size={20} />
                  </div>
                  <div className="mt-4">
                     <p className="text-4xl font-semibold tracking-tight">{stats?.total_selected || 0}</p>
                     <p className="text-xs text-black mt-1 tracking-wider">Passed</p>
                  </div>
               </div>

               <div className="card-elevated p-6 border border-border/50 rounded-md bg-card relative group min-h-[160px] flex flex-col justify-between">
                  <div className="h-10 w-10 rounded-full bg-emerald-500/10 flex items-center justify-center text-emerald-400">
                     <ShieldCheck size={20} />
                  </div>
                  <div className="mt-4">
                     <p className="text-4xl font-semibold tracking-tight">{stats?.active_tenants || 0}</p>
                     <p className="text-xs text-black mt-1 tracking-wider">Active</p>
                  </div>
               </div>

               <div className="card-elevated p-6 border border-destructive/20 rounded-md bg-card relative group min-h-[160px] flex flex-col justify-between">
                  <div className="h-10 w-10 rounded-full bg-destructive/10 flex items-center justify-center text-destructive">
                     <AlertCircle size={20} />
                  </div>
                  <div className="mt-4">
                     <p className="text-4xl font-semibold tracking-tight">{stats?.expired_tenants || 0}</p>
                     <p className="text-xs text-black mt-1 tracking-wider">Plan expire</p>
                  </div>
               </div>
            </>
          )}
        </div>

        {/* Tenant Table Section */}
        <div className="card-elevated border border-border/50 rounded-md bg-card overflow-hidden">
          <div className="p-8 border-b border-border/50 bg-secondary/5 flex flex-col md:flex-row md:items-center justify-between gap-6">
             <div>
                <h3 className="text-xl font-bold">Tenant Ecosystem</h3>
                <p className="text-sm text-muted-foreground">Manage organizational workspaces and subscriptions</p>
             </div>
             
             <div className="flex items-center gap-4">
                <div className="relative group">
                   <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
                   <input 
                     type="text" 
                     placeholder="Search by name or email..." 
                     value={search}
                     onChange={(e) => setSearch(e.target.value)}
                     className="pl-12 pr-4 h-11 w-64 bg-black/40 border border-border/50 rounded-md focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all text-sm"
                   />
                </div>
                <Button variant="outline" size="icon" className="h-11 w-11 rounded-md border-border/50 bg-black/40">
                   <Filter size={18} />
                </Button>
             </div>
          </div>

          <div className="overflow-x-auto">
             <table className="w-full text-left border-collapse">
                <thead>
                   <tr className="bg-secondary/10">
                      <th className="px-6 py-4 text-xs font-semibold text-muted-foreground tracking-[0.2em]">Tenant info</th>
                      <th className="px-6 py-4 text-xs font-semibold text-muted-foreground tracking-[0.2em]">Plan details</th>
                      <th className="px-6 py-4 text-xs font-semibold text-muted-foreground tracking-[0.2em]">Usage metrics</th>
                      <th className="px-6 py-4 text-xs font-semibold text-muted-foreground tracking-[0.2em]">Expiry status</th>
                      <th className="px-6 py-4 text-xs font-semibold text-muted-foreground tracking-[0.2em] text-right">Actions</th>
                   </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                   {loading ? (
                     Array(5).fill(0).map((_, i) => <SkeletonRow key={i} />)
                   ) : filteredTenants.length === 0 ? (
                     <tr>
                        <td colSpan={5} className="py-20">
                           <EmptyState 
                              icon={Building} 
                              title="No Tenants Found" 
                              description="No organization matches your search criteria."
                           />
                        </td>
                     </tr>
                   ) : (
                     filteredTenants.map((t) => (
                        <motion.tr 
                          key={t.id}
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          className="hover:bg-primary/5 transition-colors group"
                        >
                           <td className="px-6 py-6">
                              <div className="flex items-center gap-4">
                                 <div className="h-12 w-12 rounded-md bg-secondary/50 border border-border/50 flex items-center justify-center text-primary group-hover:scale-110 transition-transform">
                                    <Building size={20} />
                                 </div>
                                 <div>
                                    <p className="font-bold text-lg group-hover:text-primary transition-colors">{t.name}</p>
                                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                                       <Mail size={10} /> {t.admin_email}
                                    </p>
                                 </div>
                              </div>
                           </td>
                           <td className="px-6 py-6">
                              <div className="space-y-1">
                                 <div className="flex items-center gap-2">
                                    <span className="text-[10px] font-semibold uppercase tracking-tighter text-primary bg-primary/10 border border-[#00D1FF]/20 px-2 py-0.5 rounded">
                                       {t.plan_type}
                                    </span>
                                    <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                                       {t.duration_days} Days
                                    </span>
                                 </div>
                                 <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                                    <Calendar size={10} /> Exp: {new Date(t.expiry_date).toLocaleDateString()}
                                 </p>
                              </div>
                           </td>
                           <td className="px-6 py-6">
                              <div className="flex items-center gap-6">
                                 <div className="text-center">
                                    <p className="text-lg font-semibold tracking-tighter">{t.total_interviews}</p>
                                    <p className="text-[8px] uppercase font-bold text-muted-foreground">Interviews</p>
                                 </div>
                                 <div className="text-center">
                                    <p className="text-lg font-semibold tracking-tighter text-success">{t.total_selected}</p>
                                    <p className="text-[8px] uppercase font-bold text-muted-foreground">Passed</p>
                                 </div>
                              </div>
                           </td>
                           <td className="px-6 py-6">
                              <div className="space-y-1">
                                 <div className="flex items-center gap-2">
                                    <span className={`h-2 w-2 rounded-full ${t.status === 'active' ? 'bg-success shadow-[0_0_8px_rgba(34,197,94,0.5)]' : 'bg-destructive shadow-[0_0_8px_rgba(239,68,68,0.5)]'}`} />
                                    <span className={`text-xs font-bold uppercase tracking-widest ${t.status === 'active' ? 'text-success' : 'text-destructive'}`}>
                                       {t.status}
                                    </span>
                                 </div>
                                 <p className="text-[10px] text-muted-foreground font-medium">
                                    {t.remaining_days} days left
                                 </p>
                              </div>
                           </td>
                           <td className="px-6 py-6 text-right">
                              <div className="flex items-center justify-end gap-2">
                                 <Button 
                                    variant="ghost" size="icon" 
                                    className="h-9 w-9 rounded-md text-primary hover:bg-primary/10"
                                    onClick={() => handleViewTenant(t.id)}
                                 >
                                    <Eye size={18} />
                                 </Button>
                                 <Button 
                                    variant="ghost" size="icon" 
                                    className="h-9 w-9 rounded-md hover:bg-secondary/50"
                                    onClick={() => handleOpenEdit(t.id)}
                                 >
                                    <Edit3 size={18} />
                                 </Button>
                                 <Button 
                                    variant="ghost" size="icon" 
                                    className="h-9 w-9 rounded-md text-destructive hover:bg-destructive/10"
                                    onClick={() => { setSelectedTenant(t); setIsDeleteOpen(true); }}
                                 >
                                    <Trash2 size={18} />
                                 </Button>
                              </div>
                           </td>
                        </motion.tr>
                     ))
                   )}
                </tbody>
             </table>
          </div>
        </div>
      </main>

      {/* New Tenant Modal */}
      <Dialog open={isNewOpen} onOpenChange={setIsNewOpen}>
        <DialogContent className="bg-card border-border/50 rounded-md max-w-2xl overflow-hidden shadow-2xl">
          <DialogHeader className="p-8 border-b border-border/50 bg-secondary/5">
            <DialogTitle className="text-2xl font-semibold tracking-tight flex items-center gap-3">
               <Building className="text-primary" /> Create Enterprise Tenant
            </DialogTitle>
          </DialogHeader>
          
          <div className="p-8 grid grid-cols-1 md:grid-cols-2 gap-6 max-h-[70vh] overflow-y-auto custom-scrollbar">
             <div className="space-y-4 md:col-span-2">
                <Label className="text-[10px] font-semibold uppercase tracking-widest text-primary">Core Identity</Label>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                   <div className="space-y-2">
                      <Label htmlFor="name" className="text-xs font-bold text-muted-foreground">Workspace Name</Label>
                      <Input 
                        id="name" placeholder="e.g. Acme Corp" 
                        value={formData.name} onChange={(e) => setFormData({...formData, name: e.target.value})}
                        className="h-12 bg-black/40 border-border/50 rounded-md"
                      />
                   </div>
                   <div className="space-y-2">
                      <Label htmlFor="company" className="text-xs font-bold text-muted-foreground">Legal Company Name</Label>
                      <Input 
                        id="company" placeholder="e.g. Acme Technologies Inc" 
                        value={formData.company_name} onChange={(e) => setFormData({...formData, company_name: e.target.value})}
                        className="h-12 bg-black/40 border-border/50 rounded-md"
                      />
                   </div>
                </div>
             </div>

             <div className="space-y-4 md:col-span-2">
                <Label className="text-[10px] font-semibold uppercase tracking-widest text-success">Administrative Authority</Label>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                   <div className="space-y-2">
                      <Label htmlFor="admin_name" className="text-xs font-bold text-muted-foreground">Admin Name</Label>
                      <Input 
                        id="admin_name" placeholder="Full Name" 
                        value={formData.admin_name} onChange={(e) => setFormData({...formData, admin_name: e.target.value})}
                        className="h-12 bg-black/40 border-border/50 rounded-md"
                      />
                   </div>
                   <div className="space-y-2">
                      <Label htmlFor="admin_email" className="text-xs font-bold text-muted-foreground">Admin Email</Label>
                      <Input 
                        id="admin_email" type="email" placeholder="email@company.com" 
                        value={formData.admin_email} onChange={(e) => setFormData({...formData, admin_email: e.target.value})}
                        className="h-12 bg-black/40 border-border/50 rounded-md"
                      />
                   </div>
                   <div className="space-y-2">
                      <Label htmlFor="pass" className="text-xs font-bold text-muted-foreground">Initial Password</Label>
                      <Input 
                        id="pass" type="password" placeholder="••••••••" 
                        value={formData.password} onChange={(e) => setFormData({...formData, password: e.target.value})}
                        className="h-12 bg-black/40 border-border/50 rounded-md"
                      />
                   </div>
                </div>
             </div>

             <div className="space-y-4">
                <Label className="text-[10px] font-semibold uppercase tracking-widest text-primary">Subscription Plan</Label>
                <div className="space-y-3">
                   <div className="space-y-2">
                      <Label className="text-xs font-bold text-muted-foreground">Plan Tier</Label>
                      <Select value={formData.plan_type} onValueChange={(v) => setFormData({...formData, plan_type: v})}>
                         <SelectTrigger className="h-12 bg-black/40 border-border/50 rounded-md">
                            <SelectValue placeholder="Select Plan" />
                         </SelectTrigger>
                         <SelectContent className="bg-card border-border/50 rounded-md">
                            <SelectItem value="basic">Basic (30 Days)</SelectItem>
                            <SelectItem value="professional">Professional (180 Days)</SelectItem>
                            <SelectItem value="enterprise">Enterprise (365 Days)</SelectItem>
                         </SelectContent>
                      </Select>
                   </div>
                   <div className="space-y-2">
                      <Label className="text-xs font-bold text-muted-foreground">Custom Duration (Days)</Label>
                      <Input 
                        type="number" value={formData.duration_days} onChange={(e) => setFormData({...formData, duration_days: e.target.value})}
                        className="h-12 bg-black/40 border-border/50 rounded-md"
                      />
                   </div>
                   <div className="space-y-2">
                      <Label className="text-xs font-bold text-muted-foreground">Interview Limit</Label>
                      <Input 
                        type="number" value={formData.interview_limit} onChange={(e) => setFormData({...formData, interview_limit: e.target.value})}
                        className="h-12 bg-black/40 border-border/50 rounded-md"
                      />
                   </div>
                </div>
             </div>

             <div className="space-y-4">
                <Label className="text-[10px] font-semibold uppercase tracking-widest text-warning">Lifecycle & Contact</Label>
                <div className="space-y-3">
                   <div className="space-y-2">
                      <Label className="text-xs font-bold text-muted-foreground">Start Date</Label>
                      <Input 
                        type="date" value={formData.start_date} onChange={(e) => setFormData({...formData, start_date: e.target.value})}
                        className="h-12 bg-black/40 border-border/50 rounded-md"
                      />
                   </div>
                   <div className="space-y-2">
                      <Label className="text-xs font-bold text-muted-foreground">Phone Number</Label>
                      <Input 
                        placeholder="+1 (555) 000-0000" value={formData.phone} onChange={(e) => setFormData({...formData, phone: e.target.value})}
                        className="h-12 bg-black/40 border-border/50 rounded-md"
                      />
                   </div>
                </div>
             </div>

             <div className="space-y-2 md:col-span-2">
                <Label className="text-xs font-bold text-muted-foreground">Internal Notes</Label>
                <textarea 
                  rows={3} placeholder="Add any special requirements or notes..."
                  value={formData.notes} onChange={(e) => setFormData({...formData, notes: e.target.value})}
                  className="w-full bg-black/40 border border-border/50 rounded-md p-4 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
                />
             </div>
          </div>

          <DialogFooter className="p-8 border-t border-border/50 bg-secondary/5 flex items-center gap-3">
             <Button variant="ghost" onClick={() => setIsNewOpen(false)} className="rounded-md h-12 font-bold px-8">Cancel</Button>
             <Button 
               variant="hero" onClick={handleCreateTenant} disabled={isSubmitting}
               className="rounded-md h-12 px-10 font-semibold bg-primary text-black shadow-lg shadow-primary/20"
             >
                {isSubmitting ? <Loader2 className="animate-spin mr-2" /> : "Deploy Workspace"}
             </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Tenant Modal */}
      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent className="bg-card border-border/50 rounded-md max-w-2xl overflow-hidden shadow-2xl">
          <DialogHeader className="p-8 border-b border-border/50 bg-secondary/5">
            <DialogTitle className="text-2xl font-semibold tracking-tight flex items-center gap-3">
               <Edit3 className="text-primary" /> Configure Workspace
            </DialogTitle>
          </DialogHeader>
          
          <div className="p-8 space-y-6">
             {isDetailLoading ? (
               <div className="py-20 flex flex-col items-center justify-center gap-4 text-muted-foreground">
                  <Loader2 className="h-10 w-10 animate-spin text-primary" />
                  <p className="font-bold">Retrieving configuration...</p>
               </div>
             ) : (
               <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-4">
                     <div className="space-y-2">
                        <Label className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Workspace Name</Label>
                        <Input value={formData.name} onChange={(e) => setFormData({...formData, name: e.target.value})} className="h-12 bg-black/40 border-border/50 rounded-md" />
                     </div>
                     <div className="space-y-2">
                        <Label className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Admin Email</Label>
                        <Input value={formData.admin_email} onChange={(e) => setFormData({...formData, admin_email: e.target.value})} className="h-12 bg-black/40 border-border/50 rounded-md" />
                     </div>
                     <div className="space-y-2">
                        <Label className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Status</Label>
                        <Select value={formData.status} onValueChange={(v) => setFormData({...formData, status: v})}>
                           <SelectTrigger className="h-12 bg-black/40 border-border/50 rounded-md">
                              <SelectValue />
                           </SelectTrigger>
                           <SelectContent className="bg-card border-border/50 rounded-md">
                              <SelectItem value="active">Active</SelectItem>
                              <SelectItem value="expired">Expired</SelectItem>
                              <SelectItem value="suspended">Suspended</SelectItem>
                           </SelectContent>
                        </Select>
                     </div>
                  </div>
                  <div className="space-y-4">
                     <div className="space-y-2">
                        <Label className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Plan Type</Label>
                        <Select value={formData.plan_type} onValueChange={(v) => setFormData({...formData, plan_type: v})}>
                           <SelectTrigger className="h-12 bg-black/40 border-border/50 rounded-md">
                              <SelectValue />
                           </SelectTrigger>
                           <SelectContent className="bg-card border-border/50 rounded-md">
                              <SelectItem value="basic">Basic</SelectItem>
                              <SelectItem value="professional">Professional</SelectItem>
                              <SelectItem value="enterprise">Enterprise</SelectItem>
                           </SelectContent>
                        </Select>
                     </div>
                     <div className="space-y-2">
                        <Label className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Plan Duration (Days)</Label>
                        <Input type="number" value={formData.duration_days} onChange={(e) => setFormData({...formData, duration_days: e.target.value})} className="h-12 bg-black/40 border-border/50 rounded-md" />
                     </div>
                     <div className="space-y-2">
                        <Label className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Expiry Date</Label>
                        <Input type="date" value={formData.expiry_date} onChange={(e) => setFormData({...formData, expiry_date: e.target.value})} className="h-12 bg-black/40 border-border/50 rounded-md" />
                     </div>
                     <div className="space-y-2">
                        <Label className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Interview Limit</Label>
                        <Input type="number" value={formData.interview_limit} onChange={(e) => setFormData({...formData, interview_limit: e.target.value})} className="h-12 bg-black/40 border-border/50 rounded-md" />
                     </div>
                  </div>
               </div>
             )}
          </div>

          <DialogFooter className="p-8 border-t border-border/50 bg-secondary/5 flex items-center gap-3">
             <Button variant="ghost" onClick={() => setIsEditOpen(false)} className="rounded-md h-12 font-bold px-8">Discard</Button>
             <Button 
               variant="hero" onClick={handleUpdateTenant} disabled={isSubmitting || isDetailLoading}
               className="rounded-md h-12 px-10 font-semibold bg-primary text-black shadow-lg shadow-primary/20"
             >
                {isSubmitting ? <Loader2 className="animate-spin mr-2" /> : "Save Changes"}
             </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* View Details Modal */}
      <Dialog open={isViewOpen} onOpenChange={setIsViewOpen}>
        <DialogContent className="bg-card border-border/50 rounded-md max-w-3xl overflow-hidden shadow-2xl p-0">
          <div className="bg-gradient-to-br from-primary/10 via-transparent to-transparent p-10 border-b border-border/50 relative overflow-hidden">
             <div className="absolute top-0 right-0 w-64 h-64 bg-primary/5 blur-[80px] -mr-32 -mt-32 rounded-full" />
             <div className="relative flex flex-col md:flex-row md:items-center justify-between gap-8">
                <div className="space-y-4">
                   <div className="px-3 py-1 bg-primary/20 text-primary text-[10px] font-semibold uppercase tracking-[0.2em] rounded-full w-fit border border-primary/20">
                      Enterprise Account
                   </div>
                   <h2 className="text-5xl font-semibold tracking-tighter">{selectedTenant?.name}</h2>
                   <div className="flex items-center gap-4 text-muted-foreground font-medium text-sm">
                      <span className="flex items-center gap-2"><Mail size={16} className="text-primary" /> {selectedTenant?.admin_email}</span>
                      <span className="flex items-center gap-2"><Calendar size={16} className="text-primary" /> Started {new Date(selectedTenant?.start_date).toLocaleDateString()}</span>
                   </div>
                </div>
                <div className="text-right">
                   <p className="text-6xl font-semibold tracking-tighter text-primary">{selectedTenant?.remaining_days}</p>
                   <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground opacity-70">Days Remaining</p>
                </div>
             </div>
          </div>

          <div className="p-10 space-y-10">
             {isDetailLoading ? (
               <div className="py-20 flex flex-col items-center justify-center gap-4 text-muted-foreground">
                  <Loader2 className="h-10 w-10 animate-spin text-primary" />
                  <p className="font-bold">Analyzing platform impact...</p>
               </div>
             ) : (
               <>
                 <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    {[
                      { label: "Interviews", val: tenantDetails?.interview_count, icon: FileText, color: "text-blue-400" },
                      { label: "Passed", val: tenantDetails?.passed_count, icon: CheckCircle2, color: "text-success" },
                      { label: "Recruiters", val: tenantDetails?.active_recruiters, icon: Users, color: "text-primary" },
                      { label: "Managers", val: tenantDetails?.active_managers, icon: ShieldCheck, color: "text-emerald-400" },
                    ].map((m, i) => (
                      <div key={i} className="p-6 rounded-md bg-secondary/5 border border-border/50 flex flex-col items-center justify-center text-center">
                         <m.icon size={20} className={`${m.color} mb-3`} />
                         <p className="text-2xl font-semibold tracking-tighter">{m.val || 0}</p>
                         <p className="text-[9px] uppercase font-semibold text-muted-foreground tracking-widest">{m.label}</p>
                      </div>
                    ))}
                 </div>

                 <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div className="space-y-4">
                       <h4 className="text-[10px] font-semibold uppercase tracking-[0.2em] text-primary flex items-center gap-2">
                          <Info size={12} /> Workspace Metadata
                       </h4>
                       <div className="space-y-3">
                          <div className="flex justify-between items-center p-3 rounded-md bg-black/40 border border-border/50">
                             <span className="text-xs text-muted-foreground font-medium">Company Name</span>
                             <span className="text-sm font-bold">{tenantDetails?.company_name || "N/A"}</span>
                          </div>
                          <div className="flex justify-between items-center p-3 rounded-md bg-black/40 border border-border/50">
                             <span className="text-xs text-muted-foreground font-medium">Contact Phone</span>
                             <span className="text-sm font-bold">{tenantDetails?.phone || "N/A"}</span>
                          </div>
                          <div className="flex justify-between items-center p-3 rounded-md bg-black/40 border border-border/50">
                             <span className="text-xs text-muted-foreground font-medium">Interview Limit</span>
                             <span className="text-sm font-bold">{tenantDetails?.interview_limit || "N/A"}</span>
                          </div>
                          <div className="flex justify-between items-center p-3 rounded-md bg-black/40 border border-border/50">
                             <span className="text-xs text-muted-foreground font-medium">Plan Status</span>
                             <span className="text-[10px] font-semibold uppercase bg-success/10 text-success px-2 py-0.5 rounded border border-success/20">{tenantDetails?.status}</span>
                          </div>
                       </div>
                    </div>
                    <div className="space-y-4">
                       <h4 className="text-[10px] font-semibold uppercase tracking-[0.2em] text-primary flex items-center gap-2">
                          <CreditCard size={12} /> Subscription Insights
                       </h4>
                       <div className="p-4 rounded-md bg-black/40 border border-border/50 space-y-3">
                          <p className="text-sm text-muted-foreground leading-relaxed italic">
                             "{tenantDetails?.notes || "No additional configuration notes provided for this workspace."}"
                          </p>
                          <div className="pt-3 border-t border-border/50 flex items-center gap-4">
                             <div className="flex-1">
                                <p className="text-[10px] font-semibold uppercase text-muted-foreground opacity-60">Cycle Start</p>
                                <p className="text-xs font-bold">{new Date(tenantDetails?.start_date).toLocaleDateString()}</p>
                             </div>
                             <div className="flex-1 text-right">
                                <p className="text-[10px] font-semibold uppercase text-muted-foreground opacity-60">Cycle End</p>
                                <p className="text-xs font-bold text-primary">{new Date(tenantDetails?.expiry_date).toLocaleDateString()}</p>
                             </div>
                          </div>
                       </div>
                    </div>
                 </div>
               </>
             )}
          </div>

          <div className="p-10 border-t border-border/50 bg-secondary/5 flex justify-end gap-3">
             <Button variant="outline" onClick={() => setIsViewOpen(false)} className="rounded-md font-bold h-11 border-white/10 hover:bg-white/5">Close Overview</Button>
             <Button 
                variant="hero" onClick={() => { setIsViewOpen(false); handleOpenEdit(selectedTenant?.id); }}
                className="rounded-md font-semibold h-11 px-8 bg-primary text-black"
             >
                Modify Configuration
             </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Modal */}
      <Dialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
        <DialogContent className="bg-card border-border/50 rounded-md max-w-sm overflow-hidden shadow-2xl">
          <div className="p-8 bg-destructive/10 border-b border-destructive/20 flex flex-col items-center gap-4 text-center">
             <div className="h-14 w-14 rounded-full bg-destructive/20 flex items-center justify-center text-destructive border border-destructive/30">
                <ShieldAlert size={32} />
             </div>
             <div>
                <DialogTitle className="text-2xl font-semibold tracking-tight text-foreground">Dangerous Action</DialogTitle>
                <p className="text-xs text-destructive/80 font-bold uppercase tracking-widest mt-1">Tenant Termination</p>
             </div>
          </div>
          
          <div className="p-8 text-center space-y-4">
             <p className="text-sm text-muted-foreground leading-relaxed">
                Are you absolutely sure you want to delete <span className="text-foreground font-bold">{selectedTenant?.name}</span>? 
                This will permanently remove all interviews, memberships, and data associated with this workspace.
             </p>
             <p className="text-[10px] font-semibold text-destructive/60 uppercase tracking-[0.2em] px-4 py-2 border border-destructive/20 rounded-md bg-destructive/5">
                This action cannot be reversed
             </p>
          </div>

          <DialogFooter className="p-8 pt-0 flex flex-col sm:flex-row gap-2">
            <Button variant="ghost" onClick={() => setIsDeleteOpen(false)} className="rounded-md flex-1 h-12 font-bold">Discard</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={isSubmitting} className="rounded-md flex-1 h-12 font-semibold shadow-lg shadow-destructive/20">
               {isSubmitting ? <Loader2 className="animate-spin mr-2" /> : "Confirm Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
