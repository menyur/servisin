"use client";

import { useState, useEffect, useRef } from "react";
import {
  getBookingDistancesAdmin,
  getSlotPressureAdmin,
  assignNearestTechnicianAdmin,
  updateBookingStatusAdmin,
  updateServicePriceAdmin,
  createServiceAdmin,
  toggleServiceActiveAdmin,
  updateServiceDetailAdmin,
  updateUserRoleAdmin,
  updateCommissionRateAdmin,
  assignTechnicianAdmin,
  fetchNearestTechniciansAdmin,
  setTechnicianApprovalAdmin,
  kirimUlangVerifikasiPendaftarAdmin,
  updateReportAdmin,
  confirmBookingPaymentAdmin,
  rejectPaymentProofAdmin,
  createVoucherAdmin,
  deleteVoucherAdmin,
  getCompletedBookingsCsvAdmin,
  getMonthlyReportArchivesAdmin,
  getMonthlyReportDownloadUrlAdmin,
  getKtpSignedUrlAdmin,
  createCategoryAdmin,
  updateCategoryAdmin,
  toggleCategoryActiveAdmin,
  getBookingRefundsAdmin,
  searchAdminGlobal,
} from "@/app/actions/admin";
import { formatRupiah, computeSplit, commissionBase } from "@/lib/pricing";
import { bookingArea, bookingItems, bookingQuantity, serviceLabel } from "@/lib/booking-quantity";
import { formatArea } from "@/lib/area-pricing";
import { ringkasPutusan } from "@/lib/technician-scorecard";
import { STATUS_LABELS, StatusPill } from "@/components/StatusPipeline";
import { ClipboardList, Tags, Users, UserCheck, Filter, ArrowDownWideNarrow, History, FileWarning, ChevronDown, Banknote, Percent, Star, Ticket, Plus, Trash2, Wallet, Gift, XCircle, AlertTriangle, FileDown, Loader2, Pencil, IdCard, MapPin, ImagePlay, PieChart, Mail, CalendarDays, Clock, ShieldCheck, Coins, LayoutGrid, Gauge, HandCoins, ScrollText, Search, X } from "lucide-react";
import { ServiceIcon } from "@/lib/icons";
import ServiceImageUpload from "@/components/ServiceImageUpload";
import LocationPickerMap from "@/components/LocationPickerMap";
import BalanceAdminTab from "@/components/BalanceAdminTab";
import TechnicianBalancesTab from "@/components/TechnicianBalancesTab";
import TechnicianReviewsTab from "@/components/TechnicianReviewsTab";
import TechnicianScorecardTab from "@/components/TechnicianScorecardTab";
import ServiceOptionsManager from "@/components/ServiceOptionsManager";
import BannerAdminTab from "@/components/BannerAdminTab";
import PaymentSettingsTab from "@/components/PaymentSettingsTab";
import AppFeeSettingsTab from "@/components/AppFeeSettingsTab";
import SlotCapacitySettingsTab from "@/components/SlotCapacitySettingsTab";
import SlotPressureBanner from "@/components/SlotPressureBanner";
import SlotTechnicianAssignModal from "@/components/SlotTechnicianAssignModal";
import AdminNotifyRecipientsTab from "@/components/AdminNotifyRecipientsTab";
import AdminAnalyticsTab from "@/components/AdminAnalyticsTab";
import DailyOpsBoardTab from "@/components/DailyOpsBoardTab";
import RefundAdminTab from "@/components/RefundAdminTab";
import WarrantyClaimsAdminTab from "@/components/WarrantyClaimsAdminTab";
import AccountDeletionAdminTab from "@/components/AccountDeletionAdminTab";
import AdminAuditLogTab from "@/components/AdminAuditLogTab";
import { useAdminRealtime, useAgoLabel } from "@/lib/realtime";

const ALL_STATUSES = ["pending", "paid", "in_progress", "completed", "cancelled"];

// Pilihan ikon untuk form tambah layanan (selaras src/lib/icons.js)
const ICON_CHOICES = [
  "snowflake", "hammer", "car", "wrench", "sparkles", "droplet",
  "package-open", "zap", "shower-head", "paint-roller", "building-2",
  "hard-hat", "settings-2", "disc", "life-buoy", "spray-can", "brush",
  "home", "armchair", "shirt", "help-circle",
];
const ALL_ROLES = ["customer", "technician", "admin"];

export default function AdminDashboard({ initialBookings, initialServices, initialUsers, initialReports = [], initialVouchers = [], vouchersError = null, categories = [], balanceDeposits = [], balanceDepositsError = null, withdrawals = [], withdrawalsError = null, financeSummary = null, initialBanners = [], bannersError = null, initialTechnicianBalances = [], technicianBalancesError = null, initialTechnicianAppFee = [], technicianAppFeeTotal = null, initialPiutangUmur = null, piutangAmbangHari = null, initialReviews = [], reviewsSummary = null, reviewsByTechnician = [], reviewsError = null, board = null, boardError = null, accountDeletionSummary = null, appFeeBerlaku = null, initialScorecard = [], scorecardDays = 90, scorecardError = null, initialAdjustments = [], initialAdjustmentTotal = null, initialRefunds = [], initialRefundsSummary = null, initialReadiness = null }) {
  // Tab pembuka = papan harian: pertanyaan pertama admin adalah "hari ini apa
  // yang perlu saya kerjakan?", bukan "lihat semua pesanan".
  const [tab, setTab] = useState("today");
  // Pengembalian dana pelanggan: dimuat di server (page.js) supaya lencana tab
  // dan status di kartu pesanan sudah benar sejak render pertama.
  const [refunds, setRefunds] = useState(initialRefunds || []);
  const [refundsSummary, setRefundsSummary] = useState(initialRefundsSummary || null);
  // Pantauan kuota 7 hari: dimuat dari server action setelah panel tampil.
  // Banner hanya muncul bila ada slot penuh/hampir penuh, jadi admin yang
  // membuka panel untuk hal lain tidak terganggu saat semua slot longgar.
  const [slotPressure, setSlotPressure] = useState(null);
  const [slotPressureError, setSlotPressureError] = useState(null);
  const [slotPressureLoading, setSlotPressureLoading] = useState(true);
  const [slotPressureTick, setSlotPressureTick] = useState(0);
  // Slot yang sedang diatur teknisinya (aksi cepat dari banner/tab Kuota Slot).
  const [slotAssign, setSlotAssign] = useState(null);
  const [bookings, setBookings] = useState(initialBookings);

  // ---- Pencarian global (kode pesanan / nama / email / telepon) ----
  const [cari, setCari] = useState("");
  const [hasilCari, setHasilCari] = useState(null);
  const [cariSibuk, setCariSibuk] = useState(false);
  const [cariError, setCariError] = useState("");
  // Hasil pencarian bisa menunjuk pesanan/pengguna yang tidak ada di daftar
  // yang sudah dimuat. Yang dipilih "disematkan" di atas tab tujuannya supaya
  // benar-benar terlihat, bukan hilang di urutan ribuan baris.
  const [pinnedBookingId, setPinnedBookingId] = useState(null);
  const [fokusUserId, setFokusUserId] = useState(null);
  const [services, setServices] = useState(initialServices);
  // Kategori layanan: admin bisa menambah & menonaktifkan lewat tab Kategori.
  // Salinan lokal supaya perubahan langsung tampil tanpa muat ulang halaman.
  const [categoryList, setCategoryList] = useState(categories);
  const [users, setUsers] = useState(initialUsers || []);
  const [reports, setReports] = useState(initialReports);
  const [vouchers, setVouchers] = useState(initialVouchers);
  const [busyId, setBusyId] = useState(null);
  const [bookingFilter, setBookingFilter] = useState("all"); // all | unassigned | <status>
  const [sortMode, setSortMode] = useState("newest"); // newest | oldest | upcoming | nearest

  // ============ Jarak dari titik referensi admin ============
  // Admin memasang pin titik (peta) → jarak tiap booking ber-pin diambil
  // via RPC bookings_nearby (radius maks 50 km, klamp server). Booking tanpa
  // pin tidak punya jarak (tanda “tanpa titik”). Data jarak disimpan per
  // titik: refKey berubah → cache lama dibuang.
  const [refPoint, setRefPoint] = useState(null); // { lat, lng }
  const [showRefMap, setShowRefMap] = useState(false);
  const [bookingDist, setBookingDist] = useState({}); // id → meter (null = tanpa pin)
  const [distLoading, setDistLoading] = useState(false);
  const [distError, setDistError] = useState(null);

  async function loadDistances(point) {
    setDistLoading(true);
    setDistError(null);
    try {
      const res = await getBookingDistancesAdmin(point.lat, point.lng);
      if (res.error) throw new Error(res.error);
      const map = {};
      for (const row of res.bookings || []) map[row.id] = row.distance_m;
      setBookingDist(map); // booking di luar 50 km tidak ada di hasil → tak ber-badge
    } catch (e) {
      setDistError(e.message);
    } finally {
      setDistLoading(false);
    }
  }

  function setRefAndLoad(p) {
    setRefPoint(p);
    setShowRefMap(false);
    loadDistances(p);
  }
  const [historyMode, setHistoryMode] = useState("customer"); // customer | technician
  const [expandedId, setExpandedId] = useState(null);

  // ===== Realtime panel admin (postgres_changes INSERT) =====
  // Baris baru langsung masuk antrian tanpa refresh; event dari sesi
  // browser ini sendiri dide-dup lewat pengecekan id (aksi admin sudah
  // meng-update state lokal dulu).
  const [lastLiveAt, setLastLiveAt] = useState(null);
  /** Pemberitahuan pesanan/laporan yang baru masuk (dismissible oleh admin). */
  const [arrivals, setArrivals] = useState([]);
  const catatKedatangan = (jenis, row) => {
    setArrivals((list) => [
      { id: row.id, jenis, kode: row.code || "—", waktu: Date.now() },
      ...list.filter((a) => a.id !== row.id),
    ].slice(0, 4));
  };
  const live = useAdminRealtime({
    onNewBooking: (row) => {
      if (!row?.id) return;
      setBookings((bs) => (bs.some((b) => b.id === row.id) ? bs : [row, ...bs]));
      catatKedatangan("pesanan", row);
      setLastLiveAt(Date.now());
    },
    onNewReport: (row) => {
      if (!row?.id) return;
      setReports((rs) => (rs.some((r) => r.id === row.id) ? rs : [row, ...rs]));
      catatKedatangan("laporan", row);
      setLastLiveAt(Date.now());
    },
  });
  const liveAgo = useAgoLabel(lastLiveAt);
  // Badge "+N baru" hanya ketika admin sedang DI LUAR tab antrian; baris
  // tetap masuk state (list ter-update di background) — admin memutuskan
  // kapan pindah, tidak dilompat paksa saat sedang mengedit.
  const [newCount, setNewCount] = useState(0);
  // Dimulai dari isi yang SUDAH tampil: kalau dari 0, lencana "+N baru" langsung
  // menyala seolah seluruh isi halaman baru masuk.
  const lastSeenCount = useRef(initialBookings.length + (initialReports?.length || 0));
  const tabRef = useRef(tab);
  // ditulis di effect, bukan saat render (react-hooks/refs); effect di bawah
  // membacanya pada commit yang sama sehingga nilainya tetap paling baru.
  useEffect(() => {
    tabRef.current = tab;
  });
  useEffect(() => {
    const total = bookings.length + reports.length;
    const delta = total - lastSeenCount.current;
    lastSeenCount.current = total;
    if (delta > 0 && tabRef.current !== "bookings" && tabRef.current !== "reports") {
      setNewCount((n) => n + delta);
    }
  }, [bookings.length, reports.length]);
  useEffect(() => {
    if (tab === "bookings" || tab === "reports") setNewCount(0);
    // Membuka tabnya = pemberitahuan sudah sampai tujuan.
    if (tab === "bookings") setArrivals((list) => list.filter((a) => a.jenis !== "pesanan"));
    if (tab === "reports") setArrivals((list) => list.filter((a) => a.jenis !== "laporan"));
  }, [tab]);

  // Pantauan kuota: dipisah dari data server halaman supaya panel tetap cepat
  // tampil, dan bisa disegarkan setelah admin menyimpan kuota baru.
  useEffect(() => {
    let alive = true;
    getSlotPressureAdmin({ days: 7 })
      .then((r) => {
        if (!alive) return;
        if (r?.error) {
          setSlotPressureError(r.error);
          setSlotPressure(null);
        } else {
          setSlotPressure(r);
          setSlotPressureError(null);
        }
      })
      .catch((e) => {
        if (!alive) return;
        setSlotPressureError(e.message || "Gagal memuat pantauan kuota.");
      })
      .finally(() => {
        if (alive) setSlotPressureLoading(false);
      });
    return () => {
      alive = false;
    };
    // `lastLiveAt` berubah saat pesanan/laporan baru masuk lewat realtime:
    // pesanan baru bisa langsung memenuhi slot, jadi peringatan ikut disegarkan
    // tanpa admin membuka tab Kuota Slot.
  }, [slotPressureTick, lastLiveAt]);

  // Pencarian global: jeda 350 ms setelah mengetik agar satu kata tidak
  // menghasilkan lima permintaan. Minimal 2 karakter.
  useEffect(() => {
    const q = cari.trim();
    if (q.length < 2) {
      setHasilCari(null);
      setCariError("");
      setCariSibuk(false);
      return;
    }
    let aktif = true;
    setCariSibuk(true);
    const t = setTimeout(async () => {
      try {
        const r = await searchAdminGlobal(q);
        if (!aktif) return;
        if (r?.error) {
          setCariError(r.error);
          setHasilCari(null);
        } else {
          setHasilCari(r);
          setCariError("");
        }
      } catch (e) {
        if (aktif) setCariError(e.message || "Pencarian gagal.");
      } finally {
        if (aktif) setCariSibuk(false);
      }
    }, 350);
    return () => {
      aktif = false;
      clearTimeout(t);
    };
  }, [cari]);

  /** Pilih hasil pesanan: sematkan + buka tab Pesanan yang sudah ada. */
  function bukaPesananHasilCari(b) {
    // Jangan ganti baris yang SUDAH dimuat server dengan hasil pencarian yang
    // lebih tipis: hasil `searchAdminGlobal` tidak membawa `extra_charges` dan
    // signed URL foto no-show, sehingga menggantinya membuat kartu kehilangan
    // bagian biaya tambahan/bukti. Cukup sematkan baris yang ada; hanya
    // pesanan yang belum termuat yang ditambahkan.
    setBookings((bs) =>
      bs.some((x) => x.id === b.id) ? bs : [b, ...bs]
    );
    setPinnedBookingId(b.id);
    setTab("bookings");
    setBookingFilter("all");
    setExpandedId(b.id);
    setCari("");
    setHasilCari(null);
  }

  /** Pilih hasil pengguna: buka tab Pengguna dengan kartu orang itu saja. */
  function bukaPenggunaHasilCari(u) {
    setFokusUserId(u.id);
    setTab("users");
    setCari("");
    setHasilCari(null);
  }

  function refreshSlotPressure() {
    setSlotPressureLoading(true);
    setSlotPressureTick((n) => n + 1);
  }

  /** Penugasan dari modal kuota: perbarui daftar pesanan + pantauan slot. */
  function handleSlotAssigned({ bookingId, technicianId, assignments = null }) {
    const peta = new Map(
      Array.isArray(assignments)
        ? assignments.map((a) => [a.bookingId, a.technicianId])
        : [[bookingId, technicianId]]
    );
    setBookings((bs) =>
      bs.map((b) =>
        peta.has(b.id) ? { ...b, technician_id: peta.get(b.id) || null } : b
      )
    );
    refreshSlotPressure();
  }

  // Data SERVER (papan harian, lencana, antrean setor/penarikan, dst.) hanya
  // berubah lewat router.refresh() di useAdminRealtime — yang memicu prop baru.
  // Tanpa baris di bawah, state klien tetap memakai daftar dari render pertama,
  // sehingga refresh itu tampak tidak melakukan apa-apa dan admin tetap harus
  // me-reload halaman sendiri.
  // Pola resmi React "adjusting state when a prop changes": penyesuaian saat
  // render, bukan lewat effect — jadi tidak ada satu render tambahan yang masih
  // menampilkan daftar lama setelah refresh server selesai.
  const [propsTerakhir, setPropsTerakhir] = useState(null);
  if (propsTerakhir?.bookings !== initialBookings || propsTerakhir?.reports !== initialReports) {
    setPropsTerakhir({ bookings: initialBookings, reports: initialReports });
    setBookings(initialBookings);
    setReports(initialReports);
  }

  const technicians = users.filter((u) => u.role === "technician" && u.approval_status === "approved");
  const pendingTechs = users.filter((u) => u.role === "technician" && u.approval_status === "pending");
  // Lencana tab Kartu Skor: berapa teknisi yang angkanya sudah cukup untuk
  // dinilai dan perlu dibicarakan. Angka ini sengaja dihitung dari data awal
  // yang dimuat server supaya admin langsung tahu ada yang perlu dilihat.
  const scorecardPerluDitinjau = ringkasPutusan(initialScorecard || []).perluDitinjau;
  const openReportsCount = reports.filter((r) => r.status === "open").length;
  // pesanan non-COD yang masih menunggu pembayaran — perlu dicek/dikonfirmasi admin
  const unpaidCount = bookings.filter((b) => b.status === "pending" && b.payment_method !== "cod").length;
  // Ringkasan pemberitahuan kedatangan (realtime) — dipakai pita di bawah judul.
  const jumlahPesananBaru = arrivals.filter((a) => a.jenis === "pesanan").length;
  const jumlahLaporanBaru = arrivals.length - jumlahPesananBaru;

  function ratingOf(userId) {
    const u = users.find((x) => x.id === userId);
    return u?.rating_avg ? { avg: u.rating_avg, count: u.rating_count } : null;
  }

  const filteredBookings = bookings.filter((b) => {
    if (bookingFilter === "all") return true;
    if (bookingFilter === "unassigned") return !b.technician_id && b.status !== "cancelled";
    if (bookingFilter === "unpaid") return b.status === "pending" && b.payment_method !== "cod";
    return b.status === bookingFilter;
  });

  // ambil jam awal slot "08:00-10:00" untuk membandingkan jadwal pada tanggal yang sama
  function bookingStart(b) {
    const hour = Number((b.booking_time || "").split(":")[0]) || 0;
    return new Date(`${b.booking_date}T${String(hour).padStart(2, "0")}:00:00`).getTime();
  }
  const sortedBookings = [...filteredBookings].sort((a, b) => {
    if (sortMode === "oldest") return new Date(a.created_at) - new Date(b.created_at);
    if (sortMode === "upcoming") {
      // jadwal terdekat dulu; yang sudah lewat ditaruh paling belakang
      const now = Date.now();
      const aFuture = bookingStart(a) >= now;
      const bFuture = bookingStart(b) >= now;
      if (aFuture && bFuture) return bookingStart(a) - bookingStart(b);
      if (aFuture) return -1;
      if (bFuture) return 1;
      return bookingStart(b) - bookingStart(a); // yang sudah lewat: terbaru dulu
    }
    if (sortMode === "nearest" && refPoint) {
      // jarak (null = luar radius/tanpa pin) paling belakang; lalu terbaru masuk
      const d = (x) => bookingDist[x.id];
      return (d(a) ?? Infinity) - (d(b) ?? Infinity) || new Date(b.created_at) - new Date(a.created_at);
    }
    return new Date(b.created_at) - new Date(a.created_at); // newest (default)
  });

  // Pesanan yang dibuka dari pencarian selalu tampil paling atas — termasuk
  // bila umurnya sudah lama dan tidak ada di halaman daftar saat ini.
  const daftarBookingTampil = pinnedBookingId
    ? [
        bookings.find((b) => b.id === pinnedBookingId),
        ...sortedBookings.filter((b) => b.id !== pinnedBookingId),
      ].filter(Boolean)
    : sortedBookings;

  // Tab Pengguna: hasil pencarian difokuskan ke satu orang, dengan banner
  // untuk kembali ke daftar lengkap.
  const daftarUserTampil = fokusUserId
    ? users.filter((u) => u.id === fokusUserId)
    : users;

  async function changeStatus(id, status) {
    setBusyId(id);
    const res = await updateBookingStatusAdmin(id, status);
    setBusyId(null);
    if (!res.error) {
      setBookings((bs) => bs.map((b) => (b.id === id ? { ...b, status } : b)));
      // Membatalkan/menyelesaikan pesanan melepas slot; peringatan harus ikut
      // turun agar admin tidak melihat slot penuh yang sudah longgar.
      refreshSlotPressure();
      // Pembatalan pesanan yang sudah dibayar membuat kewajiban refund di
      // server — tarik ulang supaya lencana tab & kartu pesanan tidak
      // ketinggalan sampai halaman dimuat ulang.
      if (status === "cancelled") refreshRefunds();
    }
  }

  /** Segarkan antrean refund setelah admin memutuskan/mencatat satu baris. */
  async function refreshRefunds() {
    const res = await getBookingRefundsAdmin();
    if (!res.error) {
      setRefunds(res.refunds || []);
      setRefundsSummary(res.ringkasan || null);
    }
  }

  async function changePrice(id, price) {
    const res = await updateServicePriceAdmin(id, price);
    if (!res.error) setServices((ss) => ss.map((s) => (s.id === id ? { ...s, base_price: price } : s)));
  }

  function addService(service) {
    setServices((ss) => [...ss, service].sort((a, b) => (a.category_id || "").localeCompare(b.category_id || "")));
  }

  function toggleService(id, isActive) {
    setServices((ss) => ss.map((s) => (s.id === id ? { ...s, is_active: isActive } : s)));
  }

  async function changeRole(userId, role) {
    const res = await updateUserRoleAdmin(userId, role);
    if (!res.error) setUsers((us) => us.map((u) => (u.id === userId ? { ...u, role } : u)));
  }

  // Peta bookingId → hasil pencarian teknisi terdekat (GPS on-duty):
  // {loading?} | {error} | {list: [{technician_id, name, distance_m, located_at}]}
  const [nearby, setNearby] = useState({});
  async function loadNearby(bid) {
    setNearby((s) => ({ ...s, [bid]: { loading: true } }));
    const res = await fetchNearestTechniciansAdmin(bid);
    setNearby((s) => ({
      ...s,
      [bid]: res.error ? { error: res.error } : { list: res.technicians || [] },
    }));
  }

  // Kirim bahu-membahu rekomendasi one-click (hasil assignNearestTechnicianAdmin)
  // — dipakai banner rekomendasi yang tampil di kartu.
  const [recResult, setRecResult] = useState({});
  async function assignNearest(bid) {
    setRecResult((s) => ({ ...s, [bid]: { loading: true } }));
    const res = await assignNearestTechnicianAdmin(bid);
    setRecResult((s) => ({
      ...s,
      [bid]: res.error
        ? { error: res.error }
        : { done: true, name: res.name, distance_m: res.distance_m, skillMatched: res.skillMatched },
    }));
    if (!res.error) {
      setBookings((bs) => bs.map((b) => (b.id === bid ? { ...b, technician_id: res.assigned } : b)));
    }
  }

  async function assignTechnician(bookingId, technicianId) {
    const res = await assignTechnicianAdmin(bookingId, technicianId);
    if (!res.error) {
      setBookings((bs) => bs.map((b) => (b.id === bookingId ? { ...b, technician_id: technicianId || null } : b)));
    }
  }

  async function changeCommission(userId, rate) {
    const res = await updateCommissionRateAdmin(userId, rate);
    if (!res.error) {
      setUsers((us) => us.map((u) => (u.id === userId ? { ...u, commission_rate: Number(rate) } : u)));
    }
    return res;
  }

  async function reviewApplicant(userId, approvalStatus) {
    setBusyId(userId);
    const res = await setTechnicianApprovalAdmin(userId, approvalStatus);
    setBusyId(null);
    if (!res.error) {
      setUsers((us) => us.map((u) => (u.id === userId ? { ...u, approval_status: approvalStatus } : u)));
    } else {
      alert(res.error);
    }
  }

  async function handleReportUpdate(reportId, status, adminNote) {
    const res = await updateReportAdmin(reportId, status, adminNote);
    if (!res.error) {
      setReports((rs) => rs.map((r) => (r.id === reportId ? { ...r, status, admin_note: (adminNote || "").trim() || null } : r)));
    } else {
      alert(res.error);
    }
    return res;
  }

  /** Konfirmasi pembayaran pesanan pending non-COD dari panel admin. */
  async function confirmPayment(bookingId) {
    setBusyId(bookingId);
    const res = await confirmBookingPaymentAdmin(bookingId);
    setBusyId(null);
    if (!res.error) {
      setBookings((bs) => bs.map((b) => (b.id === bookingId ? { ...b, status: "paid" } : b)));
    } else {
      alert(res.error);
    }
  }

  /** Tolak bukti pembayaran dengan alasan — pelanggan bisa kirim ulang. */
  async function rejectProof(bookingId, reason) {
    setBusyId(bookingId);
    const res = await rejectPaymentProofAdmin(bookingId, reason);
    setBusyId(null);
    if (!res.error) {
      setBookings((bs) => bs.map((b) => (b.id === bookingId ? { ...b, payment_rejected: true, payment_rejection_reason: reason } : b)));
    }
    return res;
  }

  /** Unduh CSV pesanan selesai (pembukuan). */
  const [csvLoading, setCsvLoading] = useState(false);
  async function downloadCompletedCsv() {
    setCsvLoading(true);
    try {
      const res = await getCompletedBookingsCsvAdmin();
      if (res.error) {
        alert(res.error);
        return;
      }
      const blob = new Blob([res.csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = res.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally {
      setCsvLoading(false);
    }
  }

  // ===== Ringkasan harian (agregat dari state tab — tanpa query baru) =====
  // "Hari ini" mengikuti kalender WIB (UTC+7, tanpa DST) — bukan UTC —
  // supaya kartu harian cocok dengan jadwal & kebiasaan admin Indonesia.
  const today = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
  const incomingToday = bookings.filter(
    (b) =>
      b.created_at &&
      new Date(Date.parse(b.created_at) + 7 * 3600000).toISOString().slice(0, 10) === today
  ).length;
  const newReportsDash = reports.filter((r) => r.status === "open").length;
  // Teknisi idle per area: approved, tidak sedang in_progress, hari ini (WIB)
  // tidak punya tugas berjadwal — dikelompokkan menurut service_area.
  const busyTechIds = new Set(
    bookings
      .filter((b) => b.status === "in_progress" || (b.technician_id && b.booking_date === today))
    .map((b) => b.technician_id)
  );
  const idleTechs = technicians.filter((t) => !busyTechIds.has(t.id));
  const idleByArea = idleTechs.reduce((acc, t) => {
    const key = (t.service_area || "").trim() || "Tanpa area";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const idleSummary = Object.entries(idleByArea)
    .sort((a, b) => b[1] - a[1])
    .map(([area, n]) => `${area} (${n})`)
    .join(" · ") || "—";

  return (
    <div className="max-w-5xl mx-auto px-5 py-12">
      {/* ===== Kartu ringkasan harian ===== */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <button
          onClick={() => { setTab("bookings"); setBookingFilter("all"); }}
          className="card !p-4 text-left hover:!border-brand transition-colors"
        >
          <p className="text-[11px] font-semibold text-ink-soft uppercase tracking-wide">Pesanan masuk hari ini</p>
          <p className="font-display text-2xl text-navy font-bold mt-1">{incomingToday}</p>
        </button>
        <button
          onClick={() => { setTab("bookings"); setBookingFilter("unpaid"); }}
          className={`card !p-4 text-left hover:!border-brand transition-colors ${unpaidCount ? "!border-amber ring-2 ring-amber/15" : ""}`}
        >
          <p className="text-[11px] font-semibold text-ink-soft uppercase tracking-wide">Menunggu konfirmasi bayar</p>
          <p className={`font-display text-2xl font-bold mt-1 ${unpaidCount ? "text-amber" : "text-navy"}`}>{unpaidCount}</p>
        </button>
        <button
          onClick={() => setTab("tech-balances")}
          className="card !p-4 text-left hover:!border-brand transition-colors"
          title={idleSummary}
        >
          <p className="text-[11px] font-semibold text-ink-soft uppercase tracking-wide">Teknisi idle</p>
          <p className="font-display text-2xl text-mint font-bold mt-1">{idleTechs.length}</p>
          <p className="text-[11px] text-ink-soft truncate" title={idleSummary}>per area: {idleSummary}</p>
        </button>
        <button
          onClick={() => { setTab("reports"); }}
          className={`card !p-4 text-left hover:!border-brand transition-colors ${newReportsDash ? "!border-coral/60 ring-2 ring-coral/15" : ""}`}
        >
          <p className="text-[11px] font-semibold text-ink-soft uppercase tracking-wide">Laporan baru</p>
          <p className={`font-display text-2xl font-bold mt-1 ${newReportsDash ? "text-coral" : "text-navy"}`}>{newReportsDash}</p>
        </button>
      </div>

      <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
        <h1 className="font-display text-2xl text-navy">Panel Admin</h1>
        <div
          className={`flex items-center gap-2 text-xs font-semibold rounded-full px-3 py-1.5 border ${
            live
              ? "text-mint border-mint/40 bg-mint/10"
              : "text-ink-soft border-line bg-white"
          }`}
          title={live ? "Antrian Pesanan & Laporan ter-update otomatis" : "Koneksi realtime tidak tersambung — data disegarkan berkala"}
        >
          <span className={`inline-block w-2 h-2 rounded-full ${live ? "bg-mint animate-pulse" : "bg-ink-soft/50"}`} />
          {live ? "Live" : "Offline"}
          {live && liveAgo && <span className="text-ink-soft font-normal">· pembaruan {liveAgo}</span>}
          {newCount > 0 && (
            <span className="bg-navy text-white rounded-full px-2 py-0.5 text-[10px] font-bold">+{newCount} baru</span>
          )}
        </div>
      </div>

      {/* ===== Pencarian global ===== */}
      <div className="relative mb-5">
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-soft" />
          <input
            type="search"
            value={cari}
            onChange={(e) => setCari(e.target.value)}
            className="input !pl-9 !pr-9"
            placeholder="Cari kode pesanan, nama, email, atau nomor HP…"
            aria-label="Pencarian global admin"
          />
          {cariSibuk && (
            <Loader2 size={15} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-ink-soft" />
          )}
          {!cariSibuk && cari && (
            <button
              type="button"
              onClick={() => { setCari(""); setHasilCari(null); }}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-soft hover:text-navy"
              aria-label="Hapus pencarian"
            >
              <X size={15} />
            </button>
          )}
        </div>
        {cariError && <p className="text-xs text-coral mt-1.5">{cariError}</p>}
        {hasilCari && (
          (hasilCari.bookings?.length || 0) + (hasilCari.customers?.length || 0) + (hasilCari.technicians?.length || 0) === 0 ? (
            <p className="text-xs text-ink-soft mt-1.5">Tidak ada yang cocok dengan &ldquo;{hasilCari.query}&rdquo;.</p>
          ) : (
            <div className="absolute z-30 left-0 right-0 mt-2 rounded-2xl border border-line bg-white shadow-xl max-h-[70vh] overflow-y-auto">
              {(hasilCari.bookings?.length || 0) > 0 && (
                <div className="p-3 border-b border-line">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-ink-soft mb-1.5">Pesanan</p>
                  {hasilCari.bookings.map((b) => (
                    <button
                      key={b.id}
                      type="button"
                      onClick={() => bukaPesananHasilCari(b)}
                      className="w-full text-left rounded-lg px-2 py-1.5 hover:bg-brand-tint/60"
                    >
                      <span className="text-xs font-bold text-navy">{b.code}</span>{" "}
                      <span className="text-xs text-ink-soft">{serviceLabel(b)} · {b.booking_date} {b.booking_time}</span>
                      <span className="block text-[11px] text-ink-soft">
                        {b.profiles?.name || "Pelanggan"}
                        {b.technician?.name ? ` · Teknisi: ${b.technician.name}` : " · belum ada teknisi"}
                        {` · ${b.status}`}
                      </span>
                    </button>
                  ))}
                </div>
              )}
              {(hasilCari.customers?.length || 0) > 0 && (
                <div className="p-3 border-b border-line">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-ink-soft mb-1.5">Pelanggan</p>
                  {hasilCari.customers.map((u) => (
                    <button
                      key={u.id}
                      type="button"
                      onClick={() => bukaPenggunaHasilCari(u)}
                      className="w-full text-left rounded-lg px-2 py-1.5 hover:bg-brand-tint/60"
                    >
                      <span className="text-xs font-semibold text-navy">{u.name}</span>
                      <span className="block text-[11px] text-ink-soft">{u.email}{u.phone ? ` · ${u.phone}` : ""}</span>
                    </button>
                  ))}
                </div>
              )}
              {(hasilCari.technicians?.length || 0) > 0 && (
                <div className="p-3">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-ink-soft mb-1.5">Teknisi</p>
                  {hasilCari.technicians.map((u) => (
                    <button
                      key={u.id}
                      type="button"
                      onClick={() => bukaPenggunaHasilCari(u)}
                      className="w-full text-left rounded-lg px-2 py-1.5 hover:bg-brand-tint/60"
                    >
                      <span className="text-xs font-semibold text-navy">{u.name}</span>
                      <span className="block text-[11px] text-ink-soft">
                        {u.email}{u.phone ? ` · ${u.phone}` : ""}{` · ${u.approval_status || "-"}`}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )
        )}
      </div>

      {arrivals.length > 0 && (
        <div className="mb-5 rounded-xl border border-amber/40 bg-amber-tint px-4 py-3 flex items-start gap-3">
          <AlertTriangle size={16} className="text-amber mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-navy">
              {[
                jumlahPesananBaru ? `${jumlahPesananBaru} pesanan baru` : null,
                jumlahLaporanBaru ? `${jumlahLaporanBaru} laporan baru` : null,
              ]
                .filter(Boolean)
                .join(" + ")}{" "}
              masuk
              <span className="text-ink-soft font-normal"> — {arrivals.map((a) => a.kode).join(", ")}</span>
            </p>
            <p className="text-xs text-ink-soft mt-0.5">Tercatat otomatis, tanpa perlu memuat ulang halaman.</p>
          </div>
          <button
            className="btn-outline !px-3 !py-1.5 text-xs shrink-0"
            onClick={() => setTab(jumlahPesananBaru ? "bookings" : "reports")}
          >
            Lihat
          </button>
          <button
            aria-label="Tutup pemberitahuan"
            className="text-ink-soft hover:text-navy shrink-0"
            onClick={() => setArrivals([])}
          >
            <XCircle size={16} />
          </button>
        </div>
      )}

      <SlotPressureBanner
        data={slotPressure}
        loading={slotPressureLoading}
        onOpen={() => setTab("slot")}
        onRefresh={refreshSlotPressure}
        onAssign={setSlotAssign}
      />

      <div className="flex gap-2 mb-8 flex-wrap">
        <TabButton
          active={tab === "today"}
          onClick={() => setTab("today")}
          icon={CalendarDays}
          label={`Hari Ini${board?.counts?.rilisPerluTindak ? ` (${board.counts.rilisPerluTindak} lepas)` : ""}`}
        />
        <TabButton active={tab === "bookings"} onClick={() => setTab("bookings")} icon={ClipboardList} label={`Pesanan Masuk${unpaidCount ? ` (${unpaidCount} bayar)` : ""}`} />
        <TabButton active={tab === "vouchers"} onClick={() => setTab("vouchers")} icon={Ticket} label="Voucher" />
        <TabButton active={tab === "prices"} onClick={() => setTab("prices")} icon={Tags} label="Harga Layanan" />
        <TabButton
          active={tab === "categories"}
          onClick={() => setTab("categories")}
          icon={LayoutGrid}
          label={`Kategori${categoryList.some((c) => c.is_active === false) ? ` (${categoryList.filter((c) => c.is_active !== false).length}/${categoryList.length})` : ""}`}
        />
        <TabButton active={tab === "users"} onClick={() => setTab("users")} icon={Users} label="Pengguna & Teknisi" />
        <TabButton active={tab === "balance"} onClick={() => setTab("balance")} icon={Wallet} label={`Saldo Teknisi${(() => { const n = balanceDeposits.filter((d) => d.status === "pending").length + withdrawals.filter((w) => w.status === "pending").length; return n ? ` (${n})` : ""; })()}`} />
        <TabButton active={tab === "tech-balances"} onClick={() => setTab("tech-balances")} icon={PieChart} label="Saldo Aktif" />
        <TabButton
          active={tab === "refunds"}
          onClick={() => setTab("refunds")}
          icon={HandCoins}
          label={`Refund${refundsSummary?.pendingCount ? ` (${refundsSummary.pendingCount})` : ""}`}
        />
        <TabButton active={tab === "ratings"} onClick={() => setTab("ratings")} icon={Star} label="Penilaian Teknisi" />
        <TabButton
          active={tab === "scorecard"}
          onClick={() => setTab("scorecard")}
          icon={Gauge}
          label={`Kartu Skor Teknisi${scorecardPerluDitinjau ? ` (${scorecardPerluDitinjau})` : ""}`}
        />
        <TabButton active={tab === "audit"} onClick={() => setTab("audit")} icon={ScrollText} label="Jejak Audit" />
        <TabButton active={tab === "applicants"} onClick={() => setTab("applicants")} icon={UserCheck} label={`Pendaftar Teknisi${pendingTechs.length ? ` (${pendingTechs.length})` : ""}`} />
        <TabButton active={tab === "reports"} onClick={() => setTab("reports")} icon={FileWarning} label={`Laporan Masuk${openReportsCount ? ` (${openReportsCount})` : ""}`} />
        <TabButton
          active={tab === "warranty"}
          onClick={() => setTab("warranty")}
          icon={ShieldCheck}
          label={`Garansi${board?.garansiTerbuka ? ` (${board.garansiTerbuka})` : ""}`}
        />
        <TabButton
          active={tab === "account-deletion"}
          onClick={() => setTab("account-deletion")}
          icon={Trash2}
          label={`Hapus Akun${accountDeletionSummary?.diminta ? ` (${accountDeletionSummary.diminta})` : ""}`}
        />
        <TabButton active={tab === "analytics"} onClick={() => setTab("analytics")} icon={PieChart} label="Analitik" />
        <TabButton active={tab === "history"} onClick={() => setTab("history")} icon={History} label="Histori" />
        <TabButton active={tab === "banners"} onClick={() => setTab("banners")} icon={ImagePlay} label="Banner" />
        <TabButton active={tab === "pay-settings"} onClick={() => setTab("pay-settings")} icon={Banknote} label="Rekening Transfer" />
        <TabButton active={tab === "app-fee"} onClick={() => setTab("app-fee")} icon={Coins} label="Biaya Aplikasi" />
        <TabButton active={tab === "slot"} onClick={() => setTab("slot")} icon={Clock} label="Kuota Slot" />
        <TabButton active={tab === "notify-recipients"} onClick={() => setTab("notify-recipients")} icon={Mail} label="Notif Email Admin" />
      </div>

      {tab === "today" && (
        <DailyOpsBoardTab
          board={board}
          error={boardError}
          onOpenBookings={(bookingId) => {
            // Buka tab Pesanan dengan baris itu sudah terbuka — di sanalah
            // tombol penugasan teknisi berada (termasuk saran teknisi terdekat).
            if (bookingId) setExpandedId(bookingId);
            setTab("bookings");
            setBookingFilter("all");
          }}
          // Tugas piutang di papan mengarah ke tab Saldo Aktif — di sanalah
          // pengingat & pengajuan penghapusan berada.
          onOpenBalances={() => setTab("tech-balances")}
        />
      )}

      {tab === "refunds" && (
        <RefundAdminTab bookings={bookings} onChanged={refreshRefunds} />
      )}

      {tab === "warranty" && <WarrantyClaimsAdminTab />}

      {tab === "account-deletion" && <AccountDeletionAdminTab />}

      {tab === "bookings" && (
        <div>
          {/* filter: semua / belum ditugaskan / per status */}
          <div className="flex items-center gap-2 mb-4 flex-wrap">
            <span className="text-xs font-semibold text-ink-soft flex items-center gap-1.5">
              <Filter size={13} /> Filter:
            </span>
            <FilterChip active={bookingFilter === "all"} onClick={() => setBookingFilter("all")} label="Semua" />
            <FilterChip
              active={bookingFilter === "unassigned"}
              onClick={() => setBookingFilter("unassigned")}
              label={`Belum ditugaskan (${bookings.filter((b) => !b.technician_id && b.status !== "cancelled").length})`}
              amber
            />
            <FilterChip
              active={bookingFilter === "unpaid"}
              onClick={() => setBookingFilter("unpaid")}
              label={`Perlu konfirmasi bayar (${unpaidCount})`}
              amber
            />
            {ALL_STATUSES.map((s) => (
              <FilterChip
                key={s}
                active={bookingFilter === s}
                onClick={() => setBookingFilter(s)}
                label={`${STATUS_LABELS[s]} (${bookings.filter((b) => b.status === s).length})`}
              />
            ))}

            {/* export CSV pesanan selesai */}
            <button
              onClick={downloadCompletedCsv}
              disabled={csvLoading}
              className="btn-outline !px-3 !py-1.5 text-xs flex items-center gap-1.5 shrink-0 !border-mint !text-mint hover:!bg-mint-tint"
              title="Unduh semua pesanan selesai sebagai CSV"
            >
              {csvLoading ? <Loader2 size={13} className="animate-spin" /> : <FileDown size={13} />}
              {csvLoading ? "Menyiapkan..." : "CSV Selesai"}
            </button>

            {/* sorting */}
            <span className="text-xs font-semibold text-ink-soft flex items-center gap-1.5 ml-auto">
              <ArrowDownWideNarrow size={13} /> Urutkan:
            </span>
            <select
              value={sortMode}
              onChange={(e) => setSortMode(e.target.value)}
              className="input !w-auto !py-1.5 text-xs"
            >
              <option value="newest">Terbaru masuk</option>
              <option value="oldest">Terlama masuk</option>
              <option value="upcoming">Jadwal terdekat</option>
              <option value="nearest" disabled={!refPoint}>Terdekat dari titik{refPoint ? " ✓" : " (pasang titik dulu)"}</option>
            </select>

            {/* titik referensi jarak: peta collapsible pakai komponen pin booking */}
            <button
              type="button"
              onClick={() => setShowRefMap((v) => !v)}
              className={`btn-outline !py-1.5 text-xs flex items-center gap-1.5 ${refPoint ? "!border-mint !text-mint" : ""}`}
              title="Pilih titik untuk menghitung jarak tiap pesanan dan mengurutkan terdekat"
            >
              <MapPin size={13} />
              {distLoading ? "Memuat jarak..." : refPoint ? `Titik ✓ (${refPoint.lat.toFixed(4)}, ${refPoint.lng.toFixed(4)})` : "Pilih titik jarak"}
            </button>
            {showRefMap && (
              <div className="w-full mt-2">
                <LocationPickerMap
                  value={refPoint}
                  onChange={(p) => setRefAndLoad(p)}
                />
              </div>
            )}
            {refPoint && !distLoading && !distError && (
              <span className="text-[11px] text-ink-soft">
                Jarak dihitung untuk {Object.keys(bookingDist).length} pesanan ber-pin (radius ≤ 50 km)
              </span>
            )}
            {distError && <span className="text-[11px] text-coral">{distError}</span>}
          </div>

          <div className="space-y-4">
          {daftarBookingTampil.length === 0 && (
            <p className="text-ink-soft">{bookings.length === 0 ? "Belum ada pesanan masuk." : "Tidak ada pesanan yang cocok dengan filter ini."}</p>
          )}
          {daftarBookingTampil.map((b) => {
            const unassigned = !b.technician_id && b.status !== "cancelled";
            const needsPayConfirm = b.status === "pending" && b.payment_method !== "cod";
            // Jumlah unit (bookings.quantity, migrasi booking-quantity). Pesanan
            // lama / web yang belum memakai pemilih jumlah = 1 → tidak ditulis.
            const qty = bookingQuantity(b);
            const items = bookingItems(b);
            const multi = items.length > 1;
            // Pesanan per m²: harga satuan = rupiah per m² (jangan dibagi qty).
            const area = bookingArea(b);
            const hargaSatuan =
              area === null && !multi && qty > 1
                ? Math.round(Number(b.subtotal_price || 0) / qty)
                : null;
            const hargaPerM2 = area ? Math.round(Number(b.subtotal_price || 0) / area) : null;
            // Tarif yang dibekukan di pesanan ini (bookings.app_fee) berbeda dari
            // tarif yang berlaku sekarang → sebutkan apa adanya. Pesanan lama TIDAK
            // ditagih ulang, jadi selisihnya bukan kesalahan, melainkan riwayat.
            const tarifBerbeda =
              appFeeBerlaku != null && Number(b.app_fee) !== Number(appFeeBerlaku);
            return (
            <div key={b.id} className={`card ${unassigned ? "!border-amber ring-2 ring-amber/20" : ""} ${needsPayConfirm ? "!border-coral/60" : ""}`}>
              <div className="flex justify-between items-start flex-wrap gap-3 mb-3">
                <div>
                  <p className="font-display font-bold text-navy flex items-center gap-2 flex-wrap">
                    {b.code} · {b.profiles?.name}
                    {needsPayConfirm && (
                      <span className="pill !px-2 !py-0.5 text-[10px] bg-coral-tint text-coral font-bold flex items-center gap-1">
                        <Wallet size={11} /> Menunggu konfirmasi bayar
                      </span>
                    )}
                    {unassigned && (
                      <span className="pill !px-2 !py-0.5 text-[10px] bg-amber-tint text-amber font-bold">
                        ⚠ Belum ada teknisi
                      </span>
                    )}
                  </p>
                  <p className="text-sm text-ink-soft">
                    {serviceLabel(b)} · {b.booking_date} {b.booking_time}
                  </p>
                </div>
                <select
                  value={b.status}
                  disabled={busyId === b.id}
                  onChange={(e) => changeStatus(b.id, e.target.value)}
                  className="input !w-auto !py-2"
                >
                  {ALL_STATUSES.map((s) => (
                    <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                  ))}
                </select>
              </div>
              <div className="text-sm text-ink-soft grid sm:grid-cols-2 gap-x-6 gap-y-1 mb-3">
                <span>Telepon: {b.profiles?.phone || "-"}</span>
                <span>Email: {b.profiles?.email}</span>
                {b.voucher ? (
                  <span
                    className="text-mint sm:col-span-2"
                    title={`Voucher ${b.voucher.code} · ${voucherSourceLabel(b.voucher.source)}`}
                  >
                    Voucher: <strong className="font-semibold">{b.voucher.code}</strong> (− {" "}
                    {formatRupiah(b.voucher.amount || Number(b.discount_amount) || 0)}) · {voucherSourceLabel(b.voucher.source)}
                    {b.voucher.used_at
                      ? ` · dipakai ${new Date(b.voucher.used_at).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" })}`
                      : ""}
                  </span>
                ) : Number(b.discount_amount) > 0 ? (
                  <span className="text-mint">Diskon voucher: - {formatRupiah(b.discount_amount)}</span>
                ) : null}
                {refPoint && bookingDist[b.id] != null && (() => {
                  const d = bookingDist[b.id];
                  return (
                    <span
                      className="text-mint font-semibold"
                      title={`Jarak dari titik referensi admin (${refPoint.lat.toFixed(4)}, ${refPoint.lng.toFixed(4)})`}
                    >
                      ≈ {d < 1000 ? `${Math.round(d)} m` : `${(d / 1000).toFixed(1)} km`}
                    </span>
                  );
                })()}
                <span>Metode bayar: {b.payment_method}</span>
                {/* Rincian tagihan apa adanya: biaya aplikasi di sini adalah tarif
                    yang DITAGIHKAN pada pesanan ini (bookings.app_fee, dibekukan
                    saat pesanan dibuat), bukan tarif yang berlaku sekarang —
                    itulah dasar komisi teknisi untuk pekerjaan ini. */}
                {multi && (
                  <span className="sm:col-span-2">
                    Varian:{" "}
                    {items.map((it, i) => (
                      <span key={`${it.label}-${i}`}>
                        {i > 0 ? " + " : ""}
                        {it.label} ×{it.quantity} ({formatRupiah(it.lineTotal)})
                      </span>
                    ))}
                  </span>
                )}
                <span className="sm:col-span-2">
                  Layanan {formatRupiah(b.subtotal_price)}
                  {hargaSatuan != null && (
                    <span className="text-ink-soft">
                      {" "}({qty} unit × {formatRupiah(hargaSatuan)})
                    </span>
                  )}
                  {area !== null && (
                    <span className="text-ink-soft">
                      {" "}({formatArea(area)} × {formatRupiah(hargaPerM2)}/m²)
                    </span>
                  )}
                  {" + "}biaya aplikasi{" "}
                  <strong
                    className="text-navy"
                    title={`bookings.app_fee — tarif biaya aplikasi yang ditagihkan saat pesanan ${b.code} dibuat`}
                  >
                    {formatRupiah(b.app_fee)}
                  </strong>
                  {Number(b.discount_amount) > 0 && <> − diskon {formatRupiah(b.discount_amount)}</>}
                  {" = "}total <strong className="text-navy">{formatRupiah(b.total_price)}</strong>
                  {tarifBerbeda && (
                    <span className="text-[11px] text-ink-soft">
                      {" · "}tarif berlaku sekarang {formatRupiah(appFeeBerlaku)} — pesanan ini tetap memakai tarif saat dibuat
                    </span>
                  )}
                </span>
                <span className="sm:col-span-2">
                  Alamat: {b.address}
                  {b.lat != null && b.lng != null && (
                    <>
                      {" "}
                      <a
                        href={`https://www.google.com/maps?q=${b.lat},${b.lng}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-brand underline decoration-dotted hover:text-brand-deep"
                        title="Buka titik lokasi rumah pelanggan di Google Maps"
                      >
                        Titik lokasi (peta)
                      </a>
                    </>
                  )}
                </span>
                {b.notes && <span className="sm:col-span-2">Catatan: {b.notes}</span>}
                {b.no_show_at && (
                  <span className="sm:col-span-2 rounded-xl bg-amber-tint/50 border border-amber/30 px-3 py-2 text-amber">
                    <strong className="font-semibold">Teknisi melaporkan pelanggan tidak ada</strong>
                    {` · ${new Date(b.no_show_at).toLocaleString("id-ID", {
                      day: "2-digit",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}`}
                    {b.customer_present_at
                      ? ` · pelanggan menandai hadir ${new Date(b.customer_present_at).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}`
                      : " · belum dijawab pelanggan"}
                    {b.no_show_note && <span className="italic"> — &ldquo;{b.no_show_note}&rdquo;</span>}
                    {b.no_show_photo_url && (
                      <a
                        href={b.no_show_photo_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="ml-2 underline decoration-dotted"
                      >
                        Foto lokasi
                      </a>
                    )}
                  </span>
                )}
                {Array.isArray(b.extra_charges) && b.extra_charges.length > 0 && (
                  <span className="sm:col-span-2 rounded-xl bg-brand-tint/40 border border-brand/20 px-3 py-2 text-navy">
                    <strong className="font-semibold">Biaya tambahan</strong>
                    <span className="block text-[11px] text-ink-soft mt-0.5">
                      Hanya yang disetujui pelanggan yang masuk ke total pesanan.
                    </span>
                    {b.extra_charges.map((c) => (
                      <span key={c.id} className="block text-xs mt-1">
                        {formatRupiah(c.amount)} — {c.reason}{" "}
                        <span
                          className={
                            c.status === "approved"
                              ? "text-mint font-semibold"
                              : c.status === "rejected"
                                ? "text-coral font-semibold"
                                : "text-amber font-semibold"
                          }
                        >
                          {c.status === "approved" ? "disetujui" : c.status === "rejected" ? "ditolak" : "menunggu persetujuan"}
                        </span>
                      </span>
                    ))}
                  </span>
                )}
                {b.status === "cancelled" && (
                  <span className="sm:col-span-2 rounded-xl bg-coral-tint/50 border border-coral/30 px-3 py-2 text-coral">
                    <strong className="font-semibold">Dibatalkan pelanggan/admin</strong>
                    {b.cancelled_at
                      ? ` · ${new Date(b.cancelled_at).toLocaleString("id-ID", {
                          day: "2-digit",
                          month: "short",
                          year: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}`
                      : ""}
                    {" — "}
                    {b.cancelled_reason ? (
                      <span className="italic">&ldquo;{b.cancelled_reason}&rdquo;</span>
                    ) : (
                      <span>Tidak ada alasan tercatat.</span>
                    )}
                  </span>
                )}
                {b.status === "cancelled" && (() => {
                  // Status pengembalian dana menempel di kartu pesanan supaya
                  // admin tidak perlu membuka tab Refund untuk tahu apakah
                  // uang pelanggan sudah kembali.
                  const rf = refunds.find((x) => x.booking_id === b.id);
                  if (!rf) return null;
                  const nada =
                    rf.status === "done"
                      ? "bg-mint-tint/60 border-mint/40 text-mint"
                      : rf.status === "rejected"
                        ? "bg-coral-tint/50 border-coral/30 text-coral"
                        : "bg-amber-tint/60 border-amber/40 text-amber";
                  const label =
                    rf.status === "done"
                      ? "sudah dikembalikan"
                      : rf.status === "rejected"
                        ? "pengembalian ditolak"
                        : "menunggu transfer balik";
                  return (
                    <span className={`sm:col-span-2 rounded-xl border px-3 py-2 text-xs ${nada}`}>
                      <strong className="font-semibold">Pengembalian dana {formatRupiah(rf.amount)}</strong>{" "}
                      {label}
                      {rf.rejection_reason ? ` — ${rf.rejection_reason}` : ""}
                      {rf.status === "pending" && rf.payment_confirmed === false
                        ? " · bukti bayar pelanggan belum dikonfirmasi, periksa dulu sebelum transfer"
                        : ""}
                    </span>
                  );
                })()}
              </div>
              {(b.before_photo_url || b.after_photo_url) && (
                <div className="mb-3 rounded-xl border border-line bg-brand-tint/30 px-3 py-2">
                  <p className="text-xs font-semibold text-navy mb-2">Bukti pekerjaan dari teknisi</p>
                  <div className="flex gap-3 flex-wrap">
                    {[
                      ["Sebelum", b.before_photo_url],
                      ["Sesudah", b.after_photo_url],
                    ]
                      .filter(([, url]) => url)
                      .map(([label, url]) => (
                        <a key={label} href={url} target="_blank" rel="noreferrer" className="shrink-0" title="Klik untuk perbesar">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={url}
                            alt={`Foto ${label} ${b.code}`}
                            className="w-24 h-24 object-cover rounded-lg border-2 border-white shadow"
                          />
                          <span className="block text-[10px] text-ink-soft text-center mt-1">{label}</span>
                        </a>
                      ))}
                  </div>
                  <p className="text-[10px] text-ink-soft mt-1">
                    Dasar penyelesaian sengketa “belum selesai”. Hanya admin, teknisi, dan pelanggan pemilik yang dapat membuka.
                  </p>
                </div>
              )}
              {needsPayConfirm && (
                <div className={`mb-3 rounded-xl px-4 py-3 space-y-3 ${b.payment_rejected ? "bg-amber-tint/60 border border-amber/40" : "bg-coral-tint/50 border border-coral/30"}`}>
                  {b.payment_rejected && (
                    <p className="text-xs font-semibold text-amber flex items-center gap-1.5">
                      <AlertTriangle size={13} /> Bukti pernah ditolak — tunggu pelanggan kirim ulang, atau konfirmasi manual bila bukti baru sudah masuk.
                    </p>
                  )}
                  {b.payment_proof_url ? (
                    <div className="flex items-start gap-3 flex-wrap">
                      <a href={b.payment_proof_url} target="_blank" rel="noreferrer" className="shrink-0" title="Klik untuk perbesar">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={b.payment_proof_url}
                          alt={`Bukti pembayaran ${b.code}`}
                          className="w-20 h-20 object-cover rounded-xl border-2 border-white shadow"
                        />
                      </a>
                      <div className="text-xs space-y-1">
                        <p className="font-semibold text-navy">Bukti transfer dari pelanggan:</p>
                        <p>
                          Klaim: <strong className="text-navy">{formatRupiah(b.payment_amount)}</strong>
                          {" · "}Tagihan: <strong className="text-navy">{formatRupiah(b.total_price)}</strong>
                        </p>
                        {Number(b.payment_amount) !== Number(b.total_price) ? (
                          <p className="text-coral font-semibold">⚠ Jumlah diklaim tidak sama dengan tagihan — periksa buktinya!</p>
                        ) : (
                          <p className="text-mint font-semibold">✓ Jumlah sesuai tagihan</p>
                        )}
                        <a href={b.payment_proof_url} target="_blank" rel="noreferrer" className="text-brand font-semibold underline">
                          Buka gambar penuh →
                        </a>
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-navy">
                      <span className="font-semibold">Cek pembayaran:</span> <span className="text-ink-soft">
                        pesanan {b.payment_method} ini belum terkonfirmasi dan pelanggan belum mengirim bukti.
                      </span>
                    </p>
                  )}
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <p className="text-xs text-ink-soft">
                      {b.payment_proof_url
                        ? b.payment_rejected
                          ? "Pelanggan diminta mengirim ulang bukti. Konfirmasi manual tetap tersedia."
                          : "Sudah benar buktinya? Konfirmasi agar pesanan diproses."
                        : "Tunggu pelanggan mengirim bukti, atau konfirmasi manual bila dana sudah masuk."}
                    </p>
                    <div className="flex items-center gap-2 flex-wrap">
                      {b.payment_proof_url && !b.payment_rejected && (
                        <RejectProofButton
                          code={b.code}
                          busy={busyId === b.id}
                          onReject={(reason) => rejectProof(b.id, reason)}
                        />
                      )}
                      <button
                        onClick={() => confirmPayment(b.id)}
                        disabled={busyId === b.id}
                        className="btn-primary !px-4 !py-2 text-xs flex items-center gap-1.5 shrink-0"
                      >
                        <Wallet size={13} />
                        {busyId === b.id ? "Memproses..." : "Konfirmasi Pembayaran"}
                      </button>
                    </div>
                  </div>
                </div>
              )}
              <div className="flex items-center gap-2 pt-3 border-t border-line flex-wrap">
                <label className="text-xs font-semibold text-navy">Teknisi:</label>
                <select
                  value={b.technician_id || ""}
                  onChange={(e) => assignTechnician(b.id, e.target.value || null)}
                  className="input !w-auto !py-1.5 text-sm"
                >
                  <option value="">Belum ditugaskan</option>
                  {/* Teknisi yang SUDAH ditugaskan tetapi tidak ada di daftar
                      approved (mis. dinonaktifkan setelah ditugaskan) tetap
                      ditampilkan. Tanpa ini <select value> tidak menemukan
                      opsinya dan tampak "Belum ditugaskan" padahal ada. */}
                  {(() => {
                    const t = users.find((u) => u.id === b.technician_id);
                    if (!t || technicians.some((x) => x.id === t.id)) return null;
                    return <option value={t.id}>{t.name} (ditugaskan)</option>;
                  })()}
                  {/* Kelompok sesuai kategori layanan pesanan — saran dari
                      migrasi skill (profiles.skill = categories.id):
                      kecocokan SKILL + AREA paling atas; admin tetap bisa
                      memilih siapa pun (tidak ada yang disembunyikan). */}
                  {(() => {
                    const catId = b.services?.category_id || null;
                    const addr = (b.address || "").toLowerCase();
                    const areaOf = (t) => (t.service_area || "").trim().toLowerCase();
                    const score = (t) => {
                      let s = 0;
                      if (!t.skill || !catId) s += 1; // tanpa data skill = netral, bukan minus
                      else if (t.skill !== catId) s += 4; // keahlian tak cocok = paling bawah
                      const area = areaOf(t);
                      if (area && addr && addr.includes(area)) s -= 2; // area cocok = naik
                      else if (area) s += 1;
                      return s;
                    };
                    const label = (t) =>
                      `${t.name}${t.skill && catId && t.skill !== catId ? " (beda keahlian)" : !t.skill ? " (tanpa data skill)" : ""}${t.rating_avg ? ` — ★ ${t.rating_avg} (${t.rating_count})` : " (belum ada rating)"}`;
                    // Teknisi yang sedang ditugaskan TETAP ada di daftar:
                    // menyembunyikannya membuat <select> kehilangan opsi yang
                    // cocok dengan value dan menampilkan "Belum ditugaskan"
                    // padahal pesanan sudah punya teknisi.
                    const sorted = [...technicians].sort(
                      (a, c) => score(a) - score(c)
                    );
                    if (!catId) {
                      // Kategori layanan tidak diketahui: satu daftar tersortir
                      // netral, tanpa header grup kosong.
                      return sorted.map((t) => (
                        <option key={t.id} value={t.id}>{label(t)}</option>
                      ));
                    }
                    const matches = sorted.filter((t) => t.skill === catId);
                    const others = sorted.filter((t) => t.skill !== catId);
                    const matchLabel = (t) => {
                      const area = areaOf(t);
                      const areaOk = area && addr && addr.includes(area);
                      return `${label(t)}${areaOk ? " — ✓ area" : ""}`;
                    };
                    return (
                      <>
                        {matches.length > 0 && (
                          <optgroup label="Direkomendasikan (skill cocok)">
                            {matches.map((t) => (
                              <option key={t.id} value={t.id}>{matchLabel(t)}</option>
                            ))}
                          </optgroup>
                        )}
                        {others.length > 0 && (
                          <optgroup label={matches.length ? "Teknisi lain" : "Semua teknisi"}>
                            {others.map((t) => (
                              <option key={t.id} value={t.id}>{label(t)}</option>
                            ))}
                          </optgroup>
                        )}
                      </>
                    );
                  })()}
                </select>
                {b.technician_id && ratingOf(b.technician_id) && (
                  <span className="text-xs text-amber font-semibold flex items-center gap-1" title="Rating rata-rata dari ulasan pelanggan">
                    ★ {ratingOf(b.technician_id).avg} ({ratingOf(b.technician_id).count} ulasan)
                  </span>
                )}
                {technicians.length === 0 && (
                  <span className="text-xs text-ink-soft">Belum ada akun teknisi — angkat lewat tab &quot;Pengguna &amp; Teknisi&quot;.</span>
                )}
                {unassigned && technicians.length > 0 && (
                  <span className="text-xs text-amber font-semibold">Pilih teknisi sebelum jadwal kedatangan.</span>
                )}
              </div>
              {/* Panel teknisi terdekat — hanya untuk booking unassigned yang
                  punya titik lokasi (pin). Jarak dihitung server dari posisi
                  GPS on-duty teknisi; koordinat teknisi tidak pernah tampil. */}
              {unassigned && b.lat != null && (
                <div className="pt-2">
                  <button
                    type="button"
                    onClick={() => loadNearby(b.id)}
                    disabled={nearby[b.id]?.loading}
                    className="btn-outline !py-1.5 text-xs flex items-center gap-1.5"
                  >
                    <MapPin size={13} />
                    {nearby[b.id]?.loading ? "Mencari..." : "Cari teknisi terdekat (GPS on-duty)"}
                  </button>
                  {nearby[b.id]?.error && (
                    <p className="text-xs text-coral mt-2">{nearby[b.id].error}</p>
                  )}

                  {/* younger technology: rekomendasi one-click gabungan
                      jarak teknisi-on-duty + kesesuaian skill → assign. */}
                  {recResult[b.id]?.done ? (
                    <span className="text-xs mint font-semibold flex items-center gap-1">
                      ✓ Ditugaskan: {recResult[b.id].name} ({recResult[b.id].distance_m < 1000
                        ? `${Math.round(recResult[b.id].distance_m)} m`
                        : `${(recResult[b.id].distance_m / 1000).toFixed(1)} km`}
                      {recResult[b.id].skillMatched ? " — ✓ skill" : " — beda skill"})
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => assignNearest(b.id)}
                      disabled={recResult[b.id]?.loading || busyId === b.id}
                      className="btn-primary !py-1.5 text-xs flex items-center gap-1.5"
                    >
                      <MapPin size={13} />
                      {recResult[b.id]?.loading ? "Menugaskan..." : "Tugaskan teknisi terdekat"}
                    </button>
                  )}
                  {nearby[b.id]?.list && (
                    <ul className="mt-2 space-y-1">
                      {nearby[b.id].list.length === 0 && (
                        <li className="text-xs text-ink-soft">
                          Belum ada teknisi on-duty ber-GPS dalam radius 20 km dari titik lokasi ini.
                        </li>
                      )}
                      {nearby[b.id].list.map((t) => {
                        const mins = Math.max(0, Math.round((Date.now() - new Date(t.located_at).getTime()) / 60000));
                        return (
                          <li key={t.technician_id} className="flex items-center gap-2 text-xs flex-wrap">
                            <span className="font-semibold text-navy">{t.name}</span>
                            <span className="font-semibold text-mint">
                              {t.distance_m < 1000 ? `${Math.round(t.distance_m)} m` : `${(t.distance_m / 1000).toFixed(1)} km`}
                            </span>
                            <span className="text-ink-soft text-[11px]">lokasi {mins} mnt lalu</span>
                            <button
                              onClick={() => assignTechnician(b.id, t.technician_id)}
                              disabled={busyId === b.id}
                              className="btn-primary !px-2.5 !py-1 text-[11px]"
                            >
                              Tugaskan
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              )}
            </div>
            );
          })}
          </div>
        </div>
      )}

      {tab === "vouchers" && (
        <VouchersView
          vouchers={vouchers}
          users={users}
          error={vouchersError}
          onCreated={(v) => setVouchers((vs) => [v, ...vs])}
          onDeleted={(id) => setVouchers((vs) => vs.filter((v) => v.id !== id))}
        />
      )}

      {tab === "categories" && (
        <CategoryAdminTab
          categories={categoryList}
          services={services}
          onChange={setCategoryList}
        />
      )}

      {tab === "prices" && (
        <div className="space-y-5">
          <AddServiceForm categories={categoryList} services={services} onCreated={addService} onToggled={toggleService} />
          <div className="grid sm:grid-cols-2 gap-4">
            {services.map((s) => (
              <PriceRow key={s.id} service={s} onSave={changePrice} onToggleActive={toggleService} onUpdated={(id, patch) => setServices((ss) => ss.map((x) => (x.id === id ? { ...x, ...patch } : x)))} />
            ))}
          </div>
        </div>
      )}

      {tab === "users" && (
        <div className="space-y-3">
          {fokusUserId && (
            <div className="rounded-xl bg-brand-tint/50 border border-brand/30 px-4 py-2.5 flex items-center justify-between gap-3 flex-wrap">
              <p className="text-xs text-navy">Menampilkan hasil pencarian untuk satu pengguna.</p>
              <button onClick={() => setFokusUserId(null)} className="btn-outline !py-1 !px-2.5 text-xs flex items-center gap-1">
                <X size={12} /> Tampilkan semua
              </button>
            </div>
          )}
          {daftarUserTampil.length === 0 && <p className="text-ink-soft">Belum ada pengguna terdaftar.</p>}
          {daftarUserTampil.map((u) => (
            <div key={u.id} className="card flex justify-between items-center flex-wrap gap-3">
              <div>
                <p className="font-semibold text-navy text-sm flex items-center gap-2 flex-wrap">
                  {u.name}
                  {u.role === "technician" && <ApprovalBadge status={u.approval_status} />}
                  {/* Ditandai jalur pendaftaran (src/lib/signup-verification.js):
                      surel ini pernah dipakai akun yang SUDAH DIHAPUS. Bukan
                      penolakan — hanya pemberitahuan supaya "hapus akun lalu
                      daftar ulang" tidak menjadi cara mereset riwayat penilaian
                      tanpa jejak di mata admin (docs/security.md §8.4). */}
                  {u.bekas_akun_terhapus_at && (
                    <span
                      className="pill bg-amber-tint text-amber text-[10px] font-bold"
                      title="Surel ini pernah dipakai akun yang sudah dihapus. Riwayat penilaian/penyalahgunaan sebelumnya TIDAK melekat pada akun ini."
                    >
                      surel bekas akun terhapus
                    </span>
                  )}
                </p>
                <p className="text-xs text-ink-soft">{u.email} · {u.phone || "-"}</p>
                {u.role === "technician" && (
                  <p className="text-xs mt-0.5 flex items-center gap-1">
                    {u.rating_avg ? (
                      <>
                        <Star size={12} className="text-amber fill-amber" />
                        <span className="font-semibold text-navy">{u.rating_avg}</span>
                        <span className="text-ink-soft">· {u.rating_count} ulasan</span>
                      </>
                    ) : (
                      <span className="text-ink-soft">Belum ada ulasan</span>
                    )}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {u.role === "technician" && (
                  <CommissionInput value={u.commission_rate} onSave={(rate) => changeCommission(u.id, rate)} />
                )}
                <select
                  value={u.role}
                  onChange={(e) => changeRole(u.id, e.target.value)}
                  className="input !w-auto !py-2 text-sm"
                >
                  {ALL_ROLES.map((r) => (
                    <option key={r} value={r}>{roleLabel(r)}</option>
                  ))}
                </select>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === "applicants" && (
        <ApplicantList users={users} onReview={reviewApplicant} />
      )}

      {tab === "balance" && (
        <BalanceAdminTab
          initialDeposits={balanceDeposits}
          initialError={balanceDepositsError}
          technicians={technicians}
          initialWithdrawals={withdrawals}
          withdrawalsError={withdrawalsError}
          financeSummary={financeSummary}
        />
      )}

      {tab === "tech-balances" && (
        <TechnicianBalancesTab
          initialTechnicians={initialTechnicianBalances}
          initialError={technicianBalancesError}
          initialAppFeeReport={initialTechnicianAppFee}
          initialAppFeeTotal={technicianAppFeeTotal}
          initialAdjustments={initialAdjustments}
          initialAdjustmentTotal={initialAdjustmentTotal}
          initialPiutangUmur={initialPiutangUmur}
          ambangHari={piutangAmbangHari}
        />
      )}

      {tab === "scorecard" && (
        <TechnicianScorecardTab
          initialRows={initialScorecard}
          initialDays={scorecardDays}
          initialError={scorecardError}
          initialReadiness={initialReadiness}
        />
      )}

      {tab === "audit" && <AdminAuditLogTab />}

      {tab === "ratings" && (
        <TechnicianReviewsTab
          initialReviews={initialReviews}
          initialSummary={reviewsSummary}
          initialByTechnician={reviewsByTechnician}
          initialError={reviewsError}
        />
      )}

      {tab === "reports" && <ReportsView reports={reports} onUpdate={handleReportUpdate} />}

      {tab === "analytics" && <AdminAnalyticsTab bookings={bookings} />}

      {tab === "history" && (
        <div>
          <div className="flex gap-2 mb-5 flex-wrap">
            <TabButton active={historyMode === "customer"} onClick={() => { setHistoryMode("customer"); setExpandedId(null); }} label="Per Pelanggan" />
            <TabButton active={historyMode === "technician"} onClick={() => { setHistoryMode("technician"); setExpandedId(null); }} label="Per Teknisi" />
            <TabButton active={historyMode === "reports"} onClick={() => { setHistoryMode("reports"); }} label="Laporan Bulanan" />
          </div>
          {historyMode === "reports" ? (
            <MonthlyReportsView />
          ) : (
            <HistoryView
              bookings={bookings}
              mode={historyMode}
              expandedId={expandedId}
              onToggle={(id) => setExpandedId((v) => (v === id ? null : id))}
              users={users}
            />
          )}
        </div>
      )}

      {tab === "banners" && <BannerAdminTab banners={initialBanners} bannersError={bannersError} />}

      {tab === "pay-settings" && <PaymentSettingsTab />}
      {tab === "app-fee" && <AppFeeSettingsTab />}

      {tab === "slot" && (
        <SlotCapacitySettingsTab
          pressure={slotPressure}
          pressureError={slotPressureError}
          pressureLoading={slotPressureLoading}
          onSaved={refreshSlotPressure}
          onRefresh={refreshSlotPressure}
          onAssign={setSlotAssign}
        />
      )}

      {tab === "notify-recipients" && <AdminNotifyRecipientsTab />}

      {slotAssign && (
        <SlotTechnicianAssignModal
          slot={slotAssign}
          categories={categoryList}
          onClose={() => setSlotAssign(null)}
          onAssigned={handleSlotAssigned}
        />
      )}
    </div>
  );
}

function FilterChip({ active, onClick, label, amber }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition ${
        active
          ? amber
            ? "border-amber bg-amber text-white"
            : "border-brand bg-brand text-white"
          : amber
            ? "border-amber/40 text-amber bg-white hover:bg-amber-tint"
            : "border-line text-ink-soft bg-white hover:bg-brand-tint"
      }`}
    >
      {label}
    </button>
  );
}

function TabButton({ active, onClick, icon: Icon, label }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold border-2 ${active ? "border-brand bg-brand-tint text-brand-deep" : "border-line text-ink-soft"}`}
    >
      {Icon && <Icon size={16} />} {label}
    </button>
  );
}

function roleLabel(r) {
  return { customer: "Pelanggan", technician: "Teknisi", admin: "Admin" }[r] || r;
}

function CommissionInput({ value, onSave }) {
  const [rate, setRate] = useState(value ?? 10);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  // sinkron kalau nilai berubah dari luar (mis. refetch)
  useEffect(() => {
    setRate(value ?? 10);
  }, [value]);

  async function save() {
    setSaving(true);
    setError("");
    const res = await onSave(rate);
    setSaving(false);
    if (res.error) {
      setError(res.error);
    } else {
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    }
  }

  return (
    <div>
      <div className="flex items-center gap-1.5">
        <label className="text-xs text-ink-soft whitespace-nowrap" title="Persen komisi platform yang dipotong dari nilai pekerjaan selesai">
          Komisi %
        </label>
        <input
          type="number"
          min={0}
          max={100}
          step={0.5}
          value={rate}
          onChange={(e) => setRate(e.target.value)}
          className="input !w-20 !py-2 text-sm"
          aria-label="Komisi platform (%)"
        />
        <button className="btn-outline !px-3 !py-2 text-xs shrink-0" onClick={save} disabled={saving}>
          {saving ? "..." : saved ? "✓" : "Simpan"}
        </button>
      </div>
      {error && <p className="text-[10px] text-coral mt-1 max-w-[220px]">{error}</p>}
    </div>
  );
}

const REPORT_STATUS_META = {
  open: { label: "Menunggu review", cls: "bg-amber-tint text-amber" },
  reviewed: { label: "Ditinjau", cls: "bg-brand-tint text-brand-deep" },
  resolved: { label: "Selesai", cls: "bg-mint-tint text-mint" },
};

// Alasan laporan chat (migrate-chat-moderation.sql). Nilai disimpan di
// reports.reason; label di sini HARUS sama kata dengan yang dipilih pengguna di
// aplikasi (flutter_app/lib/chat_moderation.dart) supaya admin membaca kalimat
// yang sama dengan pelapor.
const CHAT_REASON_LABELS = {
  kasar: "Kata kasar, ancaman, atau pelecehan",
  penipuan: "Penipuan atau minta bayar di luar aplikasi",
  spam: "Spam, iklan, atau promosi",
  tidak_pantas: "Konten tidak pantas (foto/tautan)",
  lainnya: "Lainnya",
};

// Laporan dari menu "Laporkan percakapan" di aplikasi ditandai kind === 'chat';
// laporan lama tidak punya kolom ini dan dibaca sebagai laporan umum.
function isChatReport(r) {
  return r.kind === "chat";
}

function chatReasonLabel(reason) {
  if (!reason) return null;
  return CHAT_REASON_LABELS[reason] || reason;
}

function ReportsView({ reports, onUpdate }) {
  const [filter, setFilter] = useState("open"); // open | reviewed | resolved | all
  const [expandedId, setExpandedId] = useState(null);

  const counts = {
    open: reports.filter((r) => r.status === "open").length,
    reviewed: reports.filter((r) => r.status === "reviewed").length,
    resolved: reports.filter((r) => r.status === "resolved").length,
    all: reports.length,
  };
  const filtered = filter === "all" ? reports : reports.filter((r) => r.status === filter);

  return (
    <div>
      <div className="flex gap-2 mb-5 flex-wrap">
        <FilterChip active={filter === "open"} onClick={() => setFilter("open")} label={`Perlu review (${counts.open})`} amber />
        <FilterChip active={filter === "reviewed"} onClick={() => setFilter("reviewed")} label={`Ditinjau (${counts.reviewed})`} />
        <FilterChip active={filter === "resolved"} onClick={() => setFilter("resolved")} label={`Selesai (${counts.resolved})`} />
        <FilterChip active={filter === "all"} onClick={() => setFilter("all")} label={`Semua (${counts.all})`} />
      </div>

      {filtered.length === 0 ? (
        <p className="text-ink-soft">
          {reports.length === 0 ? "Belum ada laporan dari pelanggan atau teknisi." : "Tidak ada laporan dengan status ini."}
        </p>
      ) : (
        <div className="space-y-3">
          {filtered.map((r) => (
            <ReportCard key={r.id} report={r} expanded={expandedId === r.id} onToggle={() => setExpandedId(expandedId === r.id ? null : r.id)} onUpdate={onUpdate} />
          ))}
        </div>
      )}
    </div>
  );
}

function ReportCard({ report: r, expanded, onToggle, onUpdate }) {
  const [note, setNote] = useState(r.admin_note || "");
  const [saving, setSaving] = useState(false);
  const meta = REPORT_STATUS_META[r.status] || REPORT_STATUS_META.open;

  async function save(status) {
    setSaving(true);
    const res = await onUpdate(r.id, status, note);
    setSaving(false);
    if (!res.error && status === "resolved") onToggle();
  }

  return (
    <div className={`card !p-4 ${r.status === "open" ? "border-amber/50" : ""}`}>
      <button onClick={onToggle} className="w-full flex items-center justify-between gap-3 text-left" aria-expanded={expanded}>
        <div className="min-w-0">
          <p className="font-display font-bold text-navy text-sm truncate">{r.title}</p>
          <p className="text-xs text-ink-soft truncate">
            {r.author?.name || "?"} · {roleLabel(r.author_role)} · {fmtDateTime(r.created_at)}
            {r.bookings?.code ? ` · ${r.bookings.code}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {isChatReport(r) && (
            <span className="pill !px-2 !py-0.5 text-[10px] bg-coral-tint text-coral">
              Laporkan chat
            </span>
          )}
          <span className={`pill !px-2 !py-0.5 text-[10px] ${meta.cls}`}>{meta.label}</span>
          <ChevronDown size={16} className={`text-ink-soft transition-transform ${expanded ? "rotate-180" : ""}`} />
        </div>
      </button>

      {expanded && (
        <div className="mt-3 pt-3 border-t border-line space-y-3">
          {isChatReport(r) && (
            <p className="text-xs text-coral font-semibold">
              Laporan chat{chatReasonLabel(r.reason) ? ` — ${chatReasonLabel(r.reason)}` : ""}
              {r.target?.name ? ` · dilaporkan: ${r.target.name}` : ""}
            </p>
          )}
          <p className="text-sm text-ink-soft whitespace-pre-wrap">{r.content}</p>

          <div className="text-xs text-ink-soft space-y-1">
            {r.author?.email && <p>Email pelapor: {r.author.email}</p>}
            {r.bookings?.code && <p>Pesanan: {r.bookings.code} — {r.bookings.services?.name}</p>}
            {r.target?.name && <p>Terkait: {r.target.name} ({r.target.email})</p>}
          </div>

          <div>
            <label className="text-xs font-semibold text-navy block mb-1">Catatan admin</label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder="Hasil pemeriksaan / tindak lanjut..."
              className="input !py-2 text-sm resize-y"
            />
            <p className="text-[10px] text-ink-soft mt-1">Catatan ini terlihat oleh pelapor di dashboard mereka.</p>
          </div>

          <div className="flex gap-2 flex-wrap">
            {r.status !== "reviewed" && (
              <button className="btn-outline !py-2 text-sm" disabled={saving} onClick={() => save("reviewed")}>
                Tandai ditinjau
              </button>
            )}
            {r.status !== "resolved" && (
              <button className="btn-primary !py-2 text-sm" disabled={saving} onClick={() => save("resolved")}>
                {saving ? "Menyimpan..." : "Selesaikan"}
              </button>
            )}
            {r.status !== "open" && (
              <button className="btn-outline !py-2 text-sm" disabled={saving} onClick={() => save("open")}>
                Buka kembali
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function fmtDateTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
}

function ApprovalBadge({ status }) {
  const map = {
    pending: { label: "Menunggu review", cls: "bg-amber-tint text-amber" },
    approved: { label: "Disetujui", cls: "bg-mint-tint text-mint" },
    rejected: { label: "Ditolak", cls: "bg-coral-tint text-coral" },
  };
  const it = map[status] || map.pending;
  return <span className={`pill !px-2 !py-0.5 text-[10px] ${it.cls}`}>{it.label}</span>;
}

function ApplicantList({ users, onReview }) {
  // Kirim ulang surel verifikasi untuk pendaftar yang belum mengonfirmasi.
  // Tanpa ini, pendaftar seperti itu tidak bisa masuk sama sekali sehingga KTP
  // dan datanya tidak akan pernah bisa dinilai admin — antreannya menggantung.
  const [kirimId, setKirimId] = useState(null);
  const [pesanKirim, setPesanKirim] = useState({});
  async function kirimUlang(id) {
    setKirimId(id);
    const res = await kirimUlangVerifikasiPendaftarAdmin(id);
    setKirimId(null);
    setPesanKirim((m) => ({ ...m, [id]: res.error || "Surel verifikasi sudah dikirim ulang." }));
  }
  const applicants = users
    .filter((u) => u.role === "technician")
    .sort((a, b) => {
      const order = { pending: 0, approved: 1, rejected: 2 };
      return (order[a.approval_status] ?? 3) - (order[b.approval_status] ?? 3);
    });

  if (applicants.length === 0) {
    return <p className="text-ink-soft">Belum ada pendaftar teknisi.</p>;
  }

  return (
    <div className="space-y-3">
      {applicants.map((u) => (
        <div key={u.id} className={`card flex justify-between items-center flex-wrap gap-3 ${u.approval_status === "pending" ? "!border-amber" : ""}`}>
          <div>
            <p className="font-semibold text-navy text-sm flex items-center gap-2 flex-wrap">
              {u.name} <ApprovalBadge status={u.approval_status} />
              {u.surel_terkonfirmasi === false && (
                <span
                  className="pill !px-2 !py-0.5 text-[10px] bg-coral-tint text-coral"
                  title="Pendaftar belum mengklik tautan verifikasi, jadi belum bisa masuk dan datanya belum bisa dinilai."
                >
                  surel belum dikonfirmasi
                </span>
              )}
            </p>
            <p className="text-xs text-ink-soft">{u.email} · {u.phone || "-"} · daftar {new Date(u.created_at).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" })}</p>
            {u.surel_terkonfirmasi === false && (
              <p className="text-[11px] text-coral mt-0.5">
                Akun ini belum pernah mengonfirmasi surel — ia tidak bisa masuk sebelum tautannya diklik.
              </p>
            )}
            {pesanKirim[u.id] && <p className="text-[11px] text-ink-soft mt-0.5">{pesanKirim[u.id]}</p>}
            {u.address && (
              <p className="text-xs text-ink-soft mt-0.5 flex items-start gap-1">
                <MapPin size={12} className="mt-0.5 shrink-0" /> {u.address}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {u.ktp_url && <KtpViewer path={u.ktp_url} name={u.name} />}
            {u.surel_terkonfirmasi === false && (
              <button
                className="btn-outline !px-3 !py-2 text-xs"
                disabled={kirimId === u.id}
                onClick={() => kirimUlang(u.id)}
                title="Kirim tautan verifikasi baru (tautan lama kedaluwarsa setelah 1 jam)"
              >
                {kirimId === u.id ? <Loader2 size={14} className="animate-spin" /> : "Kirim ulang verifikasi"}
              </button>
            )}
            {u.approval_status !== "approved" && (
              <button className="btn-primary !px-4 !py-2 text-sm" disabled={onReview === null} onClick={() => onReview(u.id, "approved")}>
                Setujui
              </button>
            )}
            {u.approval_status !== "rejected" && (
              <button className="btn-outline !px-4 !py-2 text-sm !text-coral !border-coral hover:!bg-coral-tint" onClick={() => onReview(u.id, "rejected")}>
                Tolak
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Tombol lihat foto KTP pendaftar — fetch signed URL on-demand dari
 * server action (bucket ktp-documents privat) lalu tampilkan overlay.
 */
function KtpViewer({ path, name }) {
  const [loading, setLoading] = useState(false);
  const [url, setUrl] = useState(null);
  const [error, setError] = useState("");

  async function open() {
    setLoading(true);
    setError("");
    const res = await getKtpSignedUrlAdmin(path);
    setLoading(false);
    if (res.error) {
      setError(res.error);
      setTimeout(() => setError(""), 4000);
      return;
    }
    setUrl(res.url);
  }

  return (
    <>
      <div className="relative">
        <button
          onClick={open}
          disabled={loading}
          className="btn-outline !px-3 !py-2 text-xs flex items-center gap-1.5"
          title="Lihat foto KTP"
        >
          {loading ? <Loader2 size={14} className="animate-spin" /> : <IdCard size={14} />} KTP
        </button>
        {error && <p className="text-coral text-[10px] absolute top-full left-0 mt-1 w-40">{error}</p>}
      </div>
      {url && (
        <div
          className="fixed inset-0 z-[60] bg-navy/70 flex items-center justify-center p-6"
          onClick={() => setUrl(null)}
        >
          <div className="bg-white rounded-2xl p-4 max-w-lg w-full" onClick={(e) => e.stopPropagation()}>
            <p className="font-semibold text-navy text-sm mb-3 flex items-center gap-2">
              <IdCard size={16} /> KTP {name}
            </p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt={`KTP ${name}`} className="w-full rounded-xl border border-line" />
            <p className="text-[11px] text-ink-soft mt-2">Tautan berlaku 30 menit lalu otomatis kedaluwarsa.</p>
            <button className="btn-outline w-full mt-3 !py-2 text-sm" onClick={() => setUrl(null)}>
              Tutup
            </button>
          </div>
        </div>
      )}
    </>
  );
}

/* ------------------------------- HISTORI --------------------------------- */

function formatTanggal(d) {
  return new Date(d).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
}

function HistoryView({ bookings, mode, expandedId, onToggle, users = [] }) {
  // kelompokkan pesanan berdasarkan pelanggan (user_id) atau teknisi (technician_id)
  const groups = new Map();
  for (const b of bookings) {
    const key = mode === "technician" ? b.technician_id : b.user_id;
    if (!key) continue; // technician mode: pesanan belum ditugaskan dilewati
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(b);
  }

  const commissionById = new Map(users.map((u) => [u.id, Number(u.commission_rate)]));

  const rows = [...groups.entries()]
    .map(([id, list]) => {
      const sorted = [...list].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      const completed = sorted.filter((b) => b.status === "completed");
      const cancelled = sorted.filter((b) => b.status === "cancelled");
      const totalSpent = completed.reduce((sum, b) => sum + Number(b.total_price || 0), 0);
      // Komisi dihitung PER PESANAN dengan dasar total − biaya app (aturan
      // pemotongan saldo riil), lalu dijumlahkan — bukan di-split dari
      // agregat (fee hanya boleh dikurangi sekali per pesanan).
      const rate = commissionById.get(id) ?? 10;
      const splits = completed.map((b) => computeSplit(commissionBase(b.total_price, b.app_fee), rate));
      const last = sorted[0];
      return {
        id,
        list: sorted,
        name: mode === "technician"
          ? sorted[0]?.technician?.name || "(nama tidak tersedia)"
          : sorted[0]?.profiles?.name || "(nama tidak tersedia)",
        contact: mode === "technician"
          ? sorted[0]?.technician?.email || ""
          : sorted[0]?.profiles?.email || "",
        total: sorted.length,
        completed: completed.length,
        cancelled: cancelled.length,
        totalSpent,
        commission: splits.reduce((s, x) => s + x.commission, 0),
        net: splits.reduce((s, x) => s + x.net, 0),
        commissionRate: rate,
        lastDate: last?.created_at,
      };
    })
    .sort((a, b) => b.total - a.total || new Date(b.lastDate) - new Date(a.lastDate));

  // rekap total pendapatan teknisi (akumulasi nilai pekerjaan yang selesai)
  const technicianEarnings = mode === "technician"
    ? rows.reduce((sum, r) => sum + r.totalSpent, 0)
    : 0;
  const technicianNet = mode === "technician"
    ? rows.reduce((sum, r) => sum + r.net, 0)
    : 0;
  const platformCommission = mode === "technician"
    ? rows.reduce((sum, r) => sum + r.commission, 0)
    : 0;

  if (rows.length === 0) {
    return mode === "technician"
      ? <p className="text-ink-soft">Belum ada pesanan yang ditugaskan ke teknisi.</p>
      : <p className="text-ink-soft">Belum ada pesanan pelanggan.</p>;
  }

  return (
    <div>
      {mode === "technician" && (
        <div className="grid sm:grid-cols-2 gap-3 mb-4">
          <div className="card !p-4 border-brand/40">
            <div className="flex items-center gap-2 mb-1">
              <Percent size={16} className="text-brand" />
              <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">Pendapatan platform (komisi)</span>
            </div>
            <p className="font-display font-bold text-xl text-brand-deep">{formatRupiah(platformCommission)}</p>
            <p className="text-xs text-ink-soft mt-1">
              Akumulasi komisi dari pekerjaan selesai semua teknisi — indikator pendapatan platform
            </p>
          </div>
          <div className="card !p-4 border-mint/40">
            <div className="flex items-center gap-2 mb-1">
              <Banknote size={16} className="text-mint" />
              <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">Pendapatan bersih teknisi</span>
            </div>
            <p className="font-display font-bold text-xl text-mint">{formatRupiah(technicianNet)}</p>
            <p className="text-xs text-ink-soft mt-1">
              Kotor {formatRupiah(technicianEarnings)} dikurangi komisi platform
            </p>
          </div>
        </div>
      )}
      <div className="space-y-3">
      {rows.map((r) => {
        const open = expandedId === r.id;
        return (
          <div key={r.id} className="card !p-0 overflow-hidden">
            <button
              onClick={() => onToggle(r.id)}
              className="w-full text-left px-5 py-4 flex justify-between items-center flex-wrap gap-3 hover:bg-brand-tint/40 transition"
            >
              <div>
                <p className="font-display font-semibold text-navy text-sm">{r.name}</p>
                <p className="text-xs text-ink-soft">{r.contact}</p>
              </div>
              <div className="flex items-center gap-4 text-xs">
                <span className="font-semibold text-navy">{r.total} pesanan</span>
                {r.completed > 0 && <span className="text-mint font-semibold">{r.completed} selesai</span>}
                {r.cancelled > 0 && <span className="text-coral font-semibold">{r.cancelled} batal</span>}
                {mode === "technician" && r.totalSpent > 0 && (
                  <span className="text-ink-soft">
                    Pendapatan <strong className="text-mint">{formatRupiah(r.net)}</strong>
                    <span className="text-[10px] text-ink-soft"> ({r.commissionRate}% komisi)</span>
                  </span>
                )}
                {mode === "customer" && r.totalSpent > 0 && (
                  <span className="text-ink-soft">Total belanja <strong className="text-navy">{formatRupiah(r.totalSpent)}</strong></span>
                )}
                <span className="text-ink-soft">terakhir: {formatTanggal(r.lastDate)}</span>
              </div>
            </button>

            {open && (
              <div className="border-t border-line px-5 py-4 bg-paper/50">
                <div className="space-y-2">
                  {r.list.map((b) => (
                    <div key={b.id} className="text-xs bg-white border border-line rounded-xl px-4 py-2.5">
                      <div className="flex justify-between items-center gap-3 flex-wrap">
                        <span className="font-display font-bold text-navy">{b.code}</span>
                        <span className="text-ink-soft">{serviceLabel(b)}</span>
                        <span className="text-ink-soft">{b.booking_date} · {b.booking_time}</span>
                        <span className="text-navy font-semibold">{formatRupiah(b.total_price)}</span>
                        <StatusPill status={b.status} />
                      </div>
                      {b.status === "cancelled" && (
                        <p className="text-[11px] text-coral mt-1.5">
                          Alasan batal: {b.cancelled_reason || "tidak dicatat"}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
                {mode === "customer" && (
                  <p className="text-[11px] text-ink-soft mt-3">Alamat terakhir: {r.list[0]?.address || "-"}</p>
                )}
              </div>
            )}
          </div>
        );
      })}
      </div>
    </div>
  );
}

/* --------------------------- KATEGORI LAYANAN --------------------------- */

/**
 * Tab "Kategori": tambah kategori layanan, ubah nama/ikon/urutan, dan
 * aktif-nonaktifkan. Kategori nonaktif hilang dari katalog pelanggan
 * (web & aplikasi) tetapi layanan, pesanan, dan keahlian teknisinya tetap utuh
 * (supabase/migrate-admin-categories.sql).
 *
 * Tidak ada tombol Hapus: `services.category_id` memakai ON DELETE CASCADE,
 * jadi menghapus kategori akan ikut menghapus seluruh layanannya. Untuk
 * menyembunyikan, gunakan Nonaktifkan.
 */
function CategoryAdminTab({ categories, services, onChange }) {
  const emptyForm = { name: "", description: "", icon: "wrench", sortOrder: "" };
  const [form, setForm] = useState(emptyForm);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const jumlahLayanan = (id) => services.filter((s) => s.category_id === id).length;
  const aktif = categories.filter((c) => c.is_active !== false).length;

  function startAdd() {
    setForm(emptyForm);
    setEditingId(null);
    setAdding(true);
    setError("");
  }

  function startEdit(cat) {
    setForm({
      name: cat.name,
      description: cat.description || "",
      icon: cat.icon || "wrench",
      sortOrder: String(cat.sort_order ?? 0),
    });
    setEditingId(cat.id);
    setAdding(false);
    setError("");
  }

  async function save(e) {
    e.preventDefault();
    setError("");
    setSuccess("");
    setSending(true);
    const res = editingId
      ? await updateCategoryAdmin(editingId, form)
      : await createCategoryAdmin(form);
    setSending(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    onChange((list) =>
      editingId
        ? list.map((c) => (c.id === editingId ? res.category : c))
        : [...list, res.category].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    );
    setSuccess(
      editingId
        ? `✓ Kategori "${res.category.name}" diperbarui.`
        : `✓ Kategori "${res.category.name}" ditambahkan (id: ${res.category.id}).`
    );
    setAdding(false);
    setEditingId(null);
    setForm(emptyForm);
  }

  async function toggle(cat) {
    const next = cat.is_active === false;
    if (!next && !confirm(`Nonaktifkan kategori "${cat.name}"?\n\nKategori hilang dari katalog pelanggan (web & aplikasi). Layanan dan pesanan lamanya tetap ada dan bisa diaktifkan lagi kapan saja.`)) return;
    setBusyId(cat.id);
    setError("");
    const res = await toggleCategoryActiveAdmin(cat.id, next);
    setBusyId(null);
    if (res.error) {
      setError(res.error);
      return;
    }
    onChange((list) => list.map((c) => (c.id === cat.id ? { ...c, is_active: next } : c)));
    setSuccess(next ? `✓ Kategori "${cat.name}" diaktifkan.` : `✓ Kategori "${cat.name}" dinonaktifkan.`);
  }

  return (
    <div className="space-y-4">
      <div className="card !p-5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h3 className="font-display font-semibold text-navy">Kategori layanan</h3>
            <p className="text-xs text-ink-soft mt-1 max-w-xl leading-relaxed">
              {categories.length} kategori · {aktif} aktif. Kategori menaungi layanan di tab
              <b> Harga Layanan</b> dan menjadi pilihan keahlian teknisi. Nonaktifkan untuk
              menyembunyikannya dari katalog pelanggan tanpa menghapus layanan atau pesanan lama.
            </p>
          </div>
          {!adding && editingId === null && (
            <button onClick={startAdd} className="btn-primary !px-4 !py-2 text-sm flex items-center gap-1.5">
              <Plus size={14} /> Tambah kategori
            </button>
          )}
        </div>
        {success && <p className="text-xs text-mint font-medium mt-3">{success}</p>}
        {error && <p className="text-xs text-coral font-medium mt-3">{error}</p>}
      </div>

      {(adding || editingId !== null) && (
        <form onSubmit={save} className="card !p-5 space-y-3 border-brand/40">
          <p className="text-xs font-semibold text-brand">
            {editingId ? `Mengedit kategori: ${editingId}` : "Kategori baru"}
          </p>
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-semibold text-navy">Nama kategori *</span>
              <input
                className="input mt-1"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="mis. Service Elektronik"
                maxLength={60}
                required
              />
              {!editingId && (
                <span className="text-[11px] text-ink-soft">
                  Id dibuat otomatis dari nama dan tidak bisa diubah setelah tersimpan.
                </span>
              )}
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-navy">Ikon</span>
              <select
                className="input mt-1"
                value={form.icon}
                onChange={(e) => setForm((f) => ({ ...f, icon: e.target.value }))}
              >
                {ICON_CHOICES.map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </label>
            {editingId && (
              <label className="block">
                <span className="text-xs font-semibold text-navy">Urutan tampil</span>
                <input
                  type="number"
                  min="0"
                  max="999"
                  className="input mt-1"
                  value={form.sortOrder}
                  onChange={(e) => setForm((f) => ({ ...f, sortOrder: e.target.value }))}
                />
                <span className="text-[11px] text-ink-soft">Angka kecil tampil lebih dulu.</span>
              </label>
            )}
          </div>
          <label className="block">
            <span className="text-xs font-semibold text-navy">Deskripsi (opsional)</span>
            <textarea
              className="input mt-1"
              rows={2}
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="Ditampilkan di kartu kategori pada beranda"
              maxLength={200}
            />
          </label>
          <div className="flex gap-2">
            <button type="submit" disabled={sending} className="btn-primary !px-4 !py-2 text-sm flex items-center gap-1.5 disabled:opacity-60">
              {sending ? <><Loader2 size={14} className="animate-spin" /> Menyimpan...</> : editingId ? "Simpan perubahan" : "Tambah kategori"}
            </button>
            <button
              type="button"
              onClick={() => { setAdding(false); setEditingId(null); setError(""); setForm(emptyForm); }}
              className="btn-outline !px-4 !py-2 text-sm"
            >
              Batal
            </button>
          </div>
        </form>
      )}

      <div className="grid sm:grid-cols-2 gap-4">
        {categories.map((cat) => {
          const nonaktif = cat.is_active === false;
          return (
            <div key={cat.id} className={`card ${nonaktif ? "opacity-70" : ""}`}>
              <div className="flex items-start gap-3">
                <span className="w-9 h-9 rounded-lg bg-brand-tint text-brand flex items-center justify-center shrink-0">
                  <ServiceIcon name={cat.icon} size={16} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-navy text-sm flex items-center gap-2 flex-wrap">
                    {cat.name}
                    <span className="text-[10px] font-bold uppercase tracking-wide text-ink-soft bg-paper px-2 py-0.5 rounded-full">
                      {cat.id}
                    </span>
                    {nonaktif && (
                      <span className="text-[10px] font-bold uppercase tracking-wide text-coral bg-coral-tint px-2 py-0.5 rounded-full">
                        Nonaktif
                      </span>
                    )}
                  </p>
                  {cat.description && <p className="text-xs text-ink-soft mt-1 line-clamp-2">{cat.description}</p>}
                  <p className="text-[11px] text-ink-soft mt-2">
                    {jumlahLayanan(cat.id)} layanan · urutan {cat.sort_order ?? 0} · ikon {cat.icon}
                  </p>
                </div>
              </div>
              <div className="flex gap-4 mt-3 flex-wrap">
                <button onClick={() => startEdit(cat)} className="text-xs text-brand hover:text-brand-deep font-semibold flex items-center gap-1">
                  <Pencil size={12} /> Edit
                </button>
                <button
                  onClick={() => toggle(cat)}
                  disabled={busyId === cat.id}
                  className="text-xs text-ink-soft hover:text-navy flex items-center gap-1 disabled:opacity-50"
                >
                  {busyId === cat.id ? <Loader2 size={12} className="animate-spin" /> : null}
                  {nonaktif ? "Aktifkan kembali" : "Nonaktifkan"}
                </button>
                {nonaktif && (
                  <span className="text-[11px] text-ink-soft">
                    Tidak tampil di katalog pelanggan; layanannya tetap tersimpan.
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------- TAMBAH LAYANAN BARU ------------------------- */

/**
 * Form "Tambah layanan" di tab Harga Layanan: nama, kategori, harga,
 * catatan harga, estimasi durasi, deskripsi, ikon. Collapsed by default.
 */
function AddServiceForm({ categories, services, onCreated, onToggled }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [basePrice, setBasePrice] = useState("");
  const [priceNote, setPriceNote] = useState("mulai dari");
  const [durationEstimate, setDurationEstimate] = useState("");
  const [description, setDescription] = useState("");
  const [icon, setIcon] = useState("wrench");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [imageUrl, setImageUrl] = useState(null);
  // Harga per meter persegi: layanan dijual per luas bidang (cat dinding).
  const [areaPricing, setAreaPricing] = useState(false);
  const [areaNote, setAreaNote] = useState("");
  // Fitur jumlah pesanan (migrate-service-quantity-flag.sql): pelanggan boleh
  // memesan lebih dari satu dalam sekali pesanan (harga × jumlah).
  const [quantityEnabled, setQuantityEnabled] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError("");
    setSuccess("");
    setSending(true);
    const res = await createServiceAdmin({ name, categoryId, basePrice: Number(basePrice), priceNote, durationEstimate, description, icon, imageUrl, areaPricing, areaNote, quantityEnabled });
    setSending(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    onCreated(res.service);
    setSuccess(`✓ Layanan "${res.service.name}" ditambahkan — langsung tampil di landing page & booking`);
    setName(""); setBasePrice(""); setDurationEstimate(""); setDescription(""); setCategoryId(""); setPriceNote("mulai dari"); setIcon("wrench"); setImageUrl(null); setAreaPricing(false); setAreaNote(""); setQuantityEnabled(false);
    setTimeout(() => setSuccess(""), 6000);
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="btn-outline !px-4 !py-2.5 text-sm flex items-center gap-2">
        <Plus size={16} /> Tambah layanan
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="card !p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-display font-semibold text-navy">Tambah layanan baru</h3>
        <button type="button" onClick={() => setOpen(false)} className="text-ink-soft hover:text-navy text-sm flex items-center gap-1">
          <XCircle size={15} /> Tutup
        </button>
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <label className="block">
          <span className="text-xs font-semibold text-navy">Nama layanan *</span>
          <input className="input mt-1" value={name} onChange={(e) => setName(e.target.value)} placeholder="mis. Cuci Sofa" required />
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-navy">Kategori *</span>
          <select className="input mt-1" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} required>
            <option value="">— Pilih kategori —</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}{c.is_active === false ? " (nonaktif)" : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-navy">Harga dasar (Rp) *</span>
          <input type="number" min="0" className="input mt-1" value={basePrice} onChange={(e) => setBasePrice(e.target.value)} placeholder="50000" required />
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-navy">Catatan harga</span>
          <input className="input mt-1" value={priceNote} onChange={(e) => setPriceNote(e.target.value)} placeholder="mulai dari / per jam / per kg" />
        </label>
        <div className="sm:col-span-2 rounded-xl border border-line bg-paper/60 p-3">
          <label className="flex items-start gap-2">
            <input type="checkbox" className="mt-0.5" checked={areaPricing} onChange={(e) => setAreaPricing(e.target.checked)} />
            <span className="text-xs text-ink-soft leading-relaxed">
              <span className="font-semibold text-navy">Hitung per meter persegi (m²).</span>{" "}
              Pelanggan mengisi Panjang × Lebar tiap bidang, dan nominal dihitung dari luas total × harga
              {areaPricing ? " di atas" : " dasar/varian"}. Cocok untuk jasa cat & dinding.
            </span>
          </label>
          {areaPricing && (
            <label className="block mt-2">
              <span className="text-xs font-semibold text-navy">Keterangan luas (Panjang × Lebar)</span>
              <input className="input mt-1" value={areaNote} onChange={(e) => setAreaNote(e.target.value)} placeholder="Isi Panjang × Lebar tiap bidang (meter)" maxLength={200} />
              <span className="text-[11px] text-ink-soft">Tampil di formulir booking pelanggan. Kosongkan untuk teks bawaan.</span>
            </label>
          )}
        </div>
        {/* Fitur jumlah: pelanggan memilih berapa banyak dikerjakan sekaligus. */}
        <div className="sm:col-span-2 rounded-xl border border-line bg-paper/60 p-3">
          <label className="flex items-start gap-2">
            <input type="checkbox" className="mt-0.5" checked={quantityEnabled} onChange={(e) => setQuantityEnabled(e.target.checked)} />
            <span className="text-xs text-ink-soft leading-relaxed">
              <span className="font-semibold text-navy">Boleh pesan lebih dari satu (fitur jumlah).</span>{" "}
              Pelanggan memilih jumlah (1–20) saat memesan; nominal = harga satuan × jumlah. Cocok untuk layanan
              per unit/kendaraan. Bila dimatikan, satu pesanan = satu layanan.
            </span>
          </label>
        </div>
        <label className="block">
          <span className="text-xs font-semibold text-navy">Estimasi durasi</span>
          <input className="input mt-1" value={durationEstimate} onChange={(e) => setDurationEstimate(e.target.value)} placeholder="mis. 1-2 jam" />
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-navy">Ikon thumbnail</span>
          <select className="input mt-1" value={icon} onChange={(e) => setIcon(e.target.value)}>
            {ICON_CHOICES.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        </label>
      </div>

      <label className="block">
        <span className="text-xs font-semibold text-navy">Deskripsi singkat</span>
        <textarea className="input mt-1" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Ditampilkan di kartu layanan untuk membantu pelanggan memilih" />
      </label>

      <ServiceImageUpload imageUrl={imageUrl} onChange={setImageUrl} />

      {error && <p className="text-sm text-coral font-medium">{error}</p>}
      {success && <p className="text-sm text-mint font-medium">{success}</p>}

      <button type="submit" disabled={sending} className="btn-primary !py-2.5 text-sm flex items-center gap-2 disabled:opacity-60">
        {sending ? <><Loader2 size={15} className="animate-spin" /> Menyimpan...</> : <><Plus size={15} /> Tambah layanan</>}
      </button>
    </form>
  );
}

/**
 * Tanda garansi satu layanan dalam bentuk yang dikirim ke server action:
 * "0" = layanan ini dikecualikan, selain itu ikut durasi standar (tab Garansi).
 * Kolom `warranty_days` bisa belum ada bila migrasinya belum dijalankan —
 * anggap layanan bergaransi supaya panel tidak mengirim nilai tak sah.
 */
function tandaGaransi(service) {
  const n = Number(service.warranty_days ?? 7);
  return String(n > 0 ? n : 0);
}

function PriceRow({ service, onSave, onToggleActive, onUpdated }) {
  const [value, setValue] = useState(service.base_price);
  const [saved, setSaved] = useState(false);
  const [editing, setEditing] = useState(false);
  const [savingDetail, setSavingDetail] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    name: service.name,
    description: service.description || "",
    priceNote: service.price_note || "mulai dari",
    durationEstimate: service.duration_estimate || "",
    icon: service.icon || "wrench",
    imageUrl: service.image_url || null,
    // Pengecualian garansi PER LAYANAN. Panjang garansi tidak diatur di sini —
    // durasinya satu untuk semua layanan di tab "Garansi"
    // (app_settings.warranty_days); kolom ini hanya menyimpan tandanya.
    warrantyDays: tandaGaransi(service),
    // Harga per meter persegi (migrate-service-area-pricing.sql): pelanggan
    // mengisi panjang × lebar, nominal = harga satuan × luas total.
    areaPricing: service.area_pricing === true,
    areaNote: service.area_note || "",
    // Fitur jumlah (migrate-service-quantity-flag.sql).
    quantityEnabled: service.quantity_enabled === true,
  });
  const active = service.is_active !== false;
  const tanpaGaransi = Number(form.warrantyDays) === 0;

  async function save() {
    await onSave(service.id, Number(value));
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  async function saveDetail(e) {
    e.preventDefault();
    setError("");
    setSavingDetail(true);
    const res = await updateServiceDetailAdmin(service.id, form);
    setSavingDetail(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    // Baris dari DB (snake_case) — bukan `form` (camelCase) — supaya nama,
    // keterangan, dan penanda "Per m²" langsung tampil tanpa muat ulang.
    onUpdated(service.id, res.service || form);
    setEditing(false);
  }

  if (editing) {
    const setF = (k, v) => setForm((f) => ({ ...f, [k]: v }));
    return (
      <div className="card !border-brand/40">
        <p className="text-xs font-semibold text-brand mb-3">Mengedit: {service.name}</p>
        <form onSubmit={saveDetail} className="space-y-3">
          <label className="block">
            <span className="text-xs font-semibold text-navy">Nama layanan</span>
            <input className="input mt-1" value={form.name} onChange={(e) => setF("name", e.target.value)} required />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="text-xs font-semibold text-navy">Catatan harga</span>
              <input className="input mt-1" value={form.priceNote} onChange={(e) => setF("priceNote", e.target.value)} />
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-navy">Estimasi durasi</span>
              <input className="input mt-1" value={form.durationEstimate} onChange={(e) => setF("durationEstimate", e.target.value)} />
            </label>
          </div>
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={tanpaGaransi}
              onChange={(e) => setF("warrantyDays", e.target.checked ? "0" : "7")}
            />
            <span className="text-xs text-ink-soft leading-relaxed">
              <span className="font-semibold text-navy">Tanpa garansi untuk layanan ini.</span> Durasi
              garansi diatur SEKALI untuk semua layanan di tab <b>Garansi</b>; centang ini hanya
              mengecualikan layanan yang tidak boleh diklaim ulang (mis. pembersihan sekali pakai).
            </span>
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-navy">Ikon</span>
            <select className="input mt-1" value={form.icon} onChange={(e) => setF("icon", e.target.value)}>
              {ICON_CHOICES.map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </label>
          {/* Harga per meter persegi — KHUSUS layanan yang diukur per luas. */}
          <div className="rounded-xl border border-line bg-paper/60 p-3 space-y-2">
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={form.areaPricing}
                onChange={(e) => setF("areaPricing", e.target.checked)}
              />
              <span className="text-xs text-ink-soft leading-relaxed">
                <span className="font-semibold text-navy">Hitung harga per meter persegi (m²).</span>{" "}
                Harga layanan/varian dibaca sebagai rupiah per m². Pelanggan mengisi Panjang × Lebar tiap
                bidang, lalu luasnya dijumlahkan dan dikalikan harga.
              </span>
            </label>
            {form.areaPricing && (
              <label className="block">
                <span className="text-xs font-semibold text-navy">Keterangan luas (Panjang × Lebar)</span>
                <input
                  className="input mt-1"
                  value={form.areaNote}
                  onChange={(e) => setF("areaNote", e.target.value)}
                  placeholder="Isi Panjang × Lebar tiap bidang (meter)"
                  maxLength={200}
                />
                <span className="text-[11px] text-ink-soft">Tampil di formulir booking. Kosong = teks bawaan.</span>
              </label>
            )}
          </div>
          <div className="rounded-xl border border-line bg-paper/60 p-3">
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={form.quantityEnabled}
                onChange={(e) => setF("quantityEnabled", e.target.checked)}
              />
              <span className="text-xs text-ink-soft leading-relaxed">
                <span className="font-semibold text-navy">Boleh pesan lebih dari satu (fitur jumlah).</span>{" "}
                Pelanggan memilih jumlah 1–20 saat memesan; nominal = harga satuan × jumlah. Bila
                dimatikan, satu pesanan = satu layanan.
              </span>
            </label>
          </div>
          <label className="block">
            <span className="text-xs font-semibold text-navy">Deskripsi</span>
            <textarea className="input mt-1" rows={2} value={form.description} onChange={(e) => setF("description", e.target.value)} />
          </label>
          <ServiceImageUpload imageUrl={form.imageUrl} onChange={(url) => setF("imageUrl", url)} />
          {error && <p className="text-sm text-coral font-medium">{error}</p>}
          <div className="flex gap-2">
            <button type="submit" disabled={savingDetail} className="btn-primary !px-4 !py-2 text-sm flex items-center gap-1.5 disabled:opacity-60">
              {savingDetail ? <><Loader2 size={14} className="animate-spin" /> Menyimpan...</> : "Simpan perubahan"}
            </button>
            <button type="button" onClick={() => { setEditing(false); setError(""); setForm({ name: service.name, description: service.description || "", priceNote: service.price_note || "mulai dari", durationEstimate: service.duration_estimate || "", icon: service.icon || "wrench", imageUrl: service.image_url || null, warrantyDays: tandaGaransi(service), areaPricing: service.area_pricing === true, areaNote: service.area_note || "", quantityEnabled: service.quantity_enabled === true }); }} className="btn-outline !px-4 !py-2 text-sm">
              Batal
            </button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div className={`card ${!active ? "opacity-60" : ""}`}>
      {service.image_url ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img src={service.image_url} alt={service.name} className="w-full h-28 object-cover rounded-lg mb-3 border border-line" />
      ) : null}
      <p className="font-semibold text-navy text-sm mb-1 flex items-center gap-2">
        {!service.image_url && <ServiceIcon name={service.icon} size={16} />}
        {service.name}
        {!active && (
          <span className="text-[10px] font-bold uppercase tracking-wide text-ink-soft bg-line px-2 py-0.5 rounded-full">Nonaktif</span>
        )}
        {Number(service.warranty_days ?? 7) === 0 && (
          <span className="text-[10px] font-bold uppercase tracking-wide text-ink-soft bg-line px-2 py-0.5 rounded-full">Tanpa garansi</span>
        )}
        {service.area_pricing === true && (
          <span className="text-[10px] font-bold uppercase tracking-wide text-brand-deep bg-brand-tint px-2 py-0.5 rounded-full">Per m²</span>
        )}
        {service.quantity_enabled === true && (
          <span className="text-[10px] font-bold uppercase tracking-wide text-ink-soft bg-line px-2 py-0.5 rounded-full">Bisa jumlah</span>
        )}
      </p>
      <p className="text-xs text-ink-soft mb-3">{service.categories?.name}</p>
      {service.area_pricing === true && (
        <p className="text-[11px] text-ink-soft mb-3">
          Harga per meter persegi — {service.area_note || "pelanggan mengisi panjang × lebar tiap bidang"}
        </p>
      )}
      {service.description && <p className="text-xs text-ink-soft mb-3 line-clamp-2">{service.description}</p>}
      <div className="flex gap-2 items-center">
        {service.area_pricing === true && (
          <span className="text-[11px] font-semibold text-ink-soft shrink-0">Rp / m²</span>
        )}
        <input type="number" className="input" value={value} onChange={(e) => setValue(e.target.value)} />
        <button className="btn-outline !px-4 !py-2 text-sm shrink-0" onClick={save}>
          {saved ? "Tersimpan" : "Simpan"}
        </button>
      </div>
      <div className="flex gap-4 mt-3 flex-wrap">
        <button onClick={() => setEditing(true)} className="text-xs text-brand hover:text-brand-deep font-semibold flex items-center gap-1">
          <Pencil size={12} /> Edit nama & detail
        </button>
        <button
          onClick={async () => {
            await toggleServiceActiveAdmin(service.id, !active);
            onToggleActive(service.id, !active);
          }}
          className="text-xs text-ink-soft hover:text-navy flex items-center gap-1"
        >
          {active ? "Nonaktifkan" : "Aktifkan kembali"}
        </button>
      </div>
      {/* Varian ukuran (mis. PK pada AC): tambah/ubah harga/hapus */}
      <ServiceOptionsManager
        service={service}
        onOptionsChange={(id, count) => onUpdated(id, { options_count: count })}
      />
    </div>
  );
}

/* ---------------------------- LAPORAN BULANAN ---------------------------- */

/** Tab "Laporan Bulanan" di Histori: daftar arsip CSV + unduh. */
function MonthlyReportsView() {
  const [archives, setArchives] = useState(null); // null = loading
  const [error, setError] = useState("");
  const [downloadingId, setDownloadingId] = useState(null);

  useEffect(() => {
    let alive = true;
    getMonthlyReportArchivesAdmin().then((res) => {
      if (!alive) return;
      if (res.error) setError(res.error);
      else setArchives(res.archives || []);
    });
    return () => {
      alive = false;
    };
  }, []);

  async function download(id) {
    setDownloadingId(id);
    const res = await getMonthlyReportDownloadUrlAdmin(id);
    setDownloadingId(null);
    if (res.error) {
      alert(res.error);
      return;
    }
    window.open(res.url, "_blank");
  }

  const rupiah = (n) => formatRupiah(n);
  const label = (a) => new Date(a.year, a.month - 1).toLocaleDateString("id-ID", { month: "long", year: "numeric" });

  if (error) return <p className="text-ink-soft text-sm">{error}</p>;
  if (archives === null) return <p className="text-ink-soft text-sm">Memuat arsip laporan...</p>;
  if (archives.length === 0) {
    return (
      <div className="card text-center py-8">
        <FileDown size={32} className="text-ink-soft mx-auto mb-2" />
        <p className="text-ink-soft text-sm">Belum ada arsip laporan bulanan.</p>
        <p className="text-xs text-ink-soft mt-1">
          Arsip dibuat otomatis saat laporan bulanan dikirim (tanggal 1 tiap bulan) —
          atau kirim manual: <code className="bg-paper px-1.5 py-0.5 rounded">curl &quot;/api/cron/monthly-report&quot;</code>
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-soft flex items-center gap-2">
        <FileDown size={15} className="text-brand" />
        {archives.length} arsip laporan — dibuat otomatis tiap awal bulan, bisa diunduh ulang kapan saja.
      </p>
      {archives.map((a) => (
        <div key={a.id} className="card !p-4 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <span className="w-10 h-10 rounded-xl bg-brand-tint text-brand flex items-center justify-center shrink-0">
              <FileDown size={17} />
            </span>
            <div>
              <p className="font-display font-semibold text-navy text-sm">Laporan {label(a)}</p>
              <p className="text-xs text-ink-soft mt-0.5">
                {a.order_count} pesanan · pendapatan {rupiah(a.total_revenue)} · komisi {rupiah(a.total_commission)} ·
                {" "}{(Number(a.file_size) / 1024).toFixed(1)} KB
              </p>
            </div>
          </div>
          <button
            onClick={() => download(a.id)}
            disabled={downloadingId === a.id}
            className="btn-outline !px-4 !py-2 text-xs flex items-center gap-1.5 shrink-0"
          >
            {downloadingId === a.id ? <Loader2 size={13} className="animate-spin" /> : <FileDown size={13} />}
            Unduh CSV
          </button>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------- VOUCHER --------------------------------- */

/** Tombol tolak bukti pembayaran: buka input alasan, kirim ke server. */
function RejectProofButton({ code, busy, onReject }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit() {
    setSaving(true);
    setError("");
    const res = await onReject(reason);
    setSaving(false);
    if (res.error) {
      setError(res.error);
    } else {
      setOpen(false);
      setReason("");
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        disabled={busy}
        className="btn-outline !px-3 !py-2 text-xs !text-coral !border-coral hover:!bg-coral-tint flex items-center gap-1 shrink-0"
      >
        <XCircle size={13} /> Tolak bukti
      </button>
    );
  }

  return (
    <div className="w-full rounded-xl border-2 border-coral/40 bg-white px-3 py-2.5 space-y-2">
      <p className="text-xs font-semibold text-navy">
        Tolak bukti {code} — tulis alasan untuk pelanggan:
      </p>
      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        rows={2}
        placeholder="Contoh: Jumlah transfer tidak sesuai tagihan / gambar blur, tolong unggah ulang..."
        className="input !py-2 text-xs resize-y"
        maxLength={300}
      />
      {error && <p className="text-[11px] text-coral">{error}</p>}
      <div className="flex gap-2">
        <button
          onClick={submit}
          disabled={saving}
          className="btn-primary !px-3 !py-1.5 text-[11px]"
        >
          {saving ? "Mengirim..." : "Kirim penolakan"}
        </button>
        <button
          onClick={() => { setOpen(false); setReason(""); setError(""); }}
          className="btn-outline !px-3 !py-1.5 text-[11px]"
        >
          Batal
        </button>
      </div>
    </div>
  );
}

function voucherStatusLabel(v) {
  if (v.used_at) return { label: `Dipakai (${v.used_booking?.code || "-"})`, cls: "bg-brand-tint text-brand-deep" };
  if (new Date(v.expires_at) < new Date()) return { label: "Kedaluwarsa", cls: "bg-coral-tint text-coral" };
  return { label: "Aktif", cls: "bg-mint-tint text-mint" };
}

function voucherSourceLabel(s) {
  return { review_incentive: "Insentif penilaian", admin_manual: "Buat manual" }[s] || s || "-";
}

function VouchersView({ vouchers, users, error, onCreated, onDeleted }) {
  const active = vouchers.filter((v) => !v.used_at && new Date(v.expires_at) >= new Date());
  const used = vouchers.filter((v) => v.used_at);
  const totalIssued = vouchers.reduce((sum, v) => sum + Number(v.amount || 0), 0);
  const totalUsed = used.reduce((sum, v) => sum + Number(v.amount || 0), 0);

  return (
    <div>
      {/* ringkasan */}
      <div className="grid sm:grid-cols-3 gap-3 mb-6">
        <div className="card !p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft flex items-center gap-1.5">
            <Ticket size={13} className="text-brand" /> Voucher aktif
          </p>
          <p className="font-display font-bold text-xl text-navy">{active.length}</p>
        </div>
        <div className="card !p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">Total nilai terbit</p>
          <p className="font-display font-bold text-xl text-navy">{formatRupiah(totalIssued)}</p>
        </div>
        <div className="card !p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">Sudah terpakai</p>
          <p className="font-display font-bold text-xl text-brand-deep">{formatRupiah(totalUsed)}</p>
          <p className="text-[10px] text-ink-soft">{used.length} voucher dipakai di booking</p>
        </div>
      </div>

      <CreateVoucher users={users} onCreated={onCreated} />

      {error && (
        <p className="text-coral text-sm mt-4">{error}</p>
      )}

      {/* daftar */}
      <h3 className="font-display font-semibold text-navy mb-3 mt-6">Semua voucher ({vouchers.length})</h3>
      {vouchers.length === 0 && !error && (
        <p className="text-ink-soft text-sm">
          Belum ada voucher. Voucher insentif terbit otomatis setiap pelanggan mengirim penilaian BARU untuk pesanan selesai (satu voucher per pesanan); kamu juga bisa membuat manual lewat form di atas.
        </p>
      )}
      <div className="space-y-2">
        {vouchers.map((v) => {
          const st = voucherStatusLabel(v);
          return (
            <div key={v.id} className="card !p-4 flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-3">
                <span className="w-10 h-10 rounded-xl bg-brand-tint text-brand flex items-center justify-center shrink-0">
                  <Gift size={17} />
                </span>
                <div>
                  <p className="font-display font-bold text-navy text-sm flex items-center gap-2 flex-wrap">
                    {formatRupiah(v.amount)}
                    <code className="text-[11px] font-mono bg-paper px-2 py-0.5 rounded-md">{v.code}</code>
                    <span className={`pill !px-2 !py-0.5 text-[10px] ${st.cls}`}>{st.label}</span>
                  </p>
                  <p className="text-xs text-ink-soft mt-0.5">
                    {v.owner?.name || "?"} ({v.owner?.email || "-"}) · {voucherSourceLabel(v.source)} · berlaku s.d. {new Date(v.expires_at).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" })}
                  </p>
                </div>
              </div>
              {!v.used_at && (
                <button
                  onClick={async () => {
                    if (!confirm(`Hapus voucher ${v.code}?`)) return;
                    const res = await deleteVoucherAdmin(v.id);
                    if (res.error) alert(res.error);
                    else onDeleted(v.id);
                  }}
                  className="btn-outline !px-3 !py-2 text-xs !text-coral !border-coral hover:!bg-coral-tint flex items-center gap-1 shrink-0"
                >
                  <Trash2 size={13} /> Hapus
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CreateVoucher({ users, onCreated }) {
  const [open, setOpen] = useState(false);
  const [userId, setUserId] = useState("");
  const [amount, setAmount] = useState(10000);
  const [validDays, setValidDays] = useState(90);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState(null); // {code, recipient}

  async function submit(e) {
    e.preventDefault();
    setError("");
    setSaving(true);
    const res = await createVoucherAdmin({ userId, amount, validDays, note });
    setSaving(false);
    if (res.error) {
      setError(res.error);
    } else {
      setCreated({ code: res.code, recipient: res.recipient });
      setUserId("");
      setNote("");
      onCreated({ id: Date.now(), code: res.code, amount: Number(amount), expires_at: new Date(Date.now() + Number(validDays) * 86400000).toISOString(), used_at: null, source: "admin_manual", owner: { name: res.recipient } });
    }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="btn-outline !px-4 !py-2.5 text-sm flex items-center gap-2">
        <Plus size={15} /> Buat voucher manual
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="card space-y-3 max-w-xl">
      <p className="font-display font-semibold text-navy text-sm flex items-center gap-2">
        <Ticket size={15} className="text-brand" /> Buat voucher manual
      </p>
      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <label className="label">Penerima</label>
          <select value={userId} onChange={(e) => setUserId(e.target.value)} className="input !py-2 text-sm">
            <option value="">— Pilih pelanggan —</option>
            {users.filter((u) => u.role === "customer").map((u) => (
              <option key={u.id} value={u.id}>{u.name} ({u.email})</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Nominal (Rp)</label>
          <input type="number" min={1000} step={1000} value={amount} onChange={(e) => setAmount(e.target.value)} className="input !py-2 text-sm" />
        </div>
        <div>
          <label className="label">Berlaku (hari)</label>
          <input type="number" min={1} max={365} value={validDays} onChange={(e) => setValidDays(e.target.value)} className="input !py-2 text-sm" />
        </div>
        <div>
          <label className="label">Awalan kode (opsional)</label>
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={10} placeholder="PROMO" className="input !py-2 text-sm" />
        </div>
      </div>
      {error && <p className="text-coral text-xs">{error}</p>}
      {created && (
        <p className="text-mint text-xs">
          ✓ Voucher <strong>{created.code}</strong> dibuat untuk {created.recipient} — kodenya sudah bisa dilihat pelanggan di tab &quot;Voucher Saya&quot;.
        </p>
      )}
      <div className="flex gap-2">
        <button type="submit" className="btn-primary !py-2 text-sm" disabled={saving}>
          {saving ? "Membuat..." : "Buat voucher"}
        </button>
        <button type="button" className="btn-outline !py-2 text-sm" onClick={() => { setOpen(false); setCreated(null); setError(""); }}>
          Tutup
        </button>
      </div>
    </form>
  );
}
