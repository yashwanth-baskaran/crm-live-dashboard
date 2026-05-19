/** @odoo-module **/
import { Component, useState, onWillStart, onMounted, onWillUnmount, useRef, onWillUpdateProps } from "@odoo/owl";
import { registry } from "@web/core/registry";
import { useService } from "@web/core/utils/hooks";

// ─── Tiny chart component ─────────────────────────────────────────────────────
class DashChart extends Component {
    static template = "crm_live_dashboard.Chart";
    setup() {
        this.canvasRef = useRef("canvas");
        this._chart = null;
        onMounted(() => this._draw(this.props));
        onWillUpdateProps((p) => { this._destroy(); setTimeout(() => this._draw(p), 30); });
        onWillUnmount(() => this._destroy());
    }
    _destroy() { if (this._chart) { this._chart.destroy(); this._chart = null; } }
    _draw(p) {
        const el = this.canvasRef.el;
        if (!el || typeof Chart === "undefined") return;
        this._chart = new Chart(el.getContext("2d"), {
            type: p.type || "bar",
            data: { labels: p.labels || [], datasets: p.datasets || [] },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: (p.datasets || []).length > 1 } },
                scales: {
                    x: { beginAtZero: true, grid: { display: false } },
                    y: { beginAtZero: true, grid: { color: "rgba(0,0,0,0.05)" } },
                },
            },
        });
    }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function pad(n) { return String(n).padStart(2, "0"); }
function fmtDate(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }

// ─── Main Dashboard ───────────────────────────────────────────────────────────
class CrmLiveDashboard extends Component {
    static template = "crm_live_dashboard.Main";
    static components = { DashChart };

    setup() {
        this.orm = useService("orm");
        this.action = useService("action");
        this.busService = useService("bus_service");

        const today = new Date();
        this.state = useState({
            loading: true,
            error: null,
            updated: null,
            live: false,
            tab: "overview",
            period: "today",
            dateFrom: fmtDate(today),
            dateTo: fmtDate(today),
            userIds: [],
            salespersons: [],
            stages: [],
            kpis: { total: 0, stuck: 0, won: 0, lost: 0, pipe: 0 },
            funnel: [],
            breakdown: [],
            lostReasons: [],
            activity: [],
            inactive: [],
            noMoves: [],
            showShare: false,
            shareDone: false,
        });

        this._poll = null;
        this._busCb = null;

        onWillStart(async () => {
            await this._loadFilters();
            await this._fetch();
        });
        onMounted(() => {
            this._startBus();
            this._poll = setInterval(() => this._fetch(), 30000);
        });
        onWillUnmount(() => {
            clearInterval(this._poll);
            try { if (this._busCb) this.busService.unsubscribe("crm_dashboard", this._busCb); } catch (e) {}
        });
    }

    _startBus() {
        this._busCb = (notifs) => {
            for (const n of notifs) {
                if (n.type === "crm_dashboard_update") {
                    this.state.live = true;
                    this._fetch().then(() => setTimeout(() => { this.state.live = false; }, 2000));
                }
            }
        };
        try { this.busService.subscribe("crm_dashboard", this._busCb); this.busService.start(); } catch (e) {}
    }

    _getRange() {
        const today = new Date();
        const p = this.state.period;
        if (p === "yesterday") {
            const y = new Date(today); y.setDate(y.getDate() - 1);
            return [fmtDate(y), fmtDate(y)];
        }
        if (p === "today") return [fmtDate(today), fmtDate(today)];
        if (p === "last_week") {
            const end = new Date(today); end.setDate(today.getDate() - today.getDay());
            const start = new Date(end); start.setDate(end.getDate() - 6);
            return [fmtDate(start), fmtDate(end)];
        }
        if (p === "last_month") {
            const s = new Date(today.getFullYear(), today.getMonth() - 1, 1);
            const e = new Date(today.getFullYear(), today.getMonth(), 0);
            return [fmtDate(s), fmtDate(e)];
        }
        if (p === "custom") return [this.state.dateFrom, this.state.dateTo];
        return [fmtDate(today), fmtDate(today)];
    }

    async _loadFilters() {
        try {
            const stages = await this.orm.searchRead("crm.stage", [], ["id", "name", "sequence"], { order: "sequence" });
            this.state.stages = stages;
            const sps = await this.orm.readGroup("crm.lead",
                [["type", "=", "opportunity"], ["user_id", "!=", false]],
                ["user_id"], ["user_id"]);
            this.state.salespersons = sps
                .filter((r) => r.user_id)
                .map((r) => ({ id: r.user_id[0], name: r.user_id[1] }))
                .sort((a, b) => a.name.localeCompare(b.name));
        } catch (e) {
            console.warn("Filter load error:", e.message);
        }
    }

    async _fetch() {
        try {
            const [df, dt] = this._getRange();
            const dFrom = df + " 00:00:00";
            const dTo   = dt + " 23:59:59";
            const uF = this.state.userIds.length ? [["user_id", "in", this.state.userIds]] : [];
            const base = [["type", "=", "opportunity"], ["active", "=", true],
                          ["create_date", ">=", dFrom], ["create_date", "<=", dTo], ...uF];

            const [total, won, lost] = await Promise.all([
                this.orm.searchCount("crm.lead", base),
                this.orm.searchCount("crm.lead", [...base, ["probability", "=", 100]]),
                this.orm.searchCount("crm.lead", [
                    ["type", "=", "opportunity"], ["active", "=", false],
                    ["date_closed", ">=", dFrom], ["date_closed", "<=", dTo], ...uF,
                ]),
            ]);

            const pipeG = await this.orm.readGroup("crm.lead", base, ["expected_revenue:sum"], []);
            const pipe = (pipeG[0] || {}).expected_revenue || 0;

            let stuck = 0;
            if (this.state.stages.length) {
                stuck = await this.orm.searchCount("crm.lead", [
                    ["type", "=", "opportunity"], ["active", "=", true],
                    ["stage_id", "=", this.state.stages[0].id],
                    ["create_date", ">=", dFrom], ["create_date", "<=", dTo], ...uF,
                ]);
            }

            this.state.kpis = { total, won, lost, stuck, pipe };

            const stageG = await this.orm.readGroup("crm.lead", base,
                ["stage_id", "expected_revenue:sum"], ["stage_id"]);
            const smap = {};
            for (const r of stageG) {
                if (r.stage_id) smap[r.stage_id[0]] = { count: r.stage_id_count || 0, value: r.expected_revenue || 0 };
            }
            const maxCount = Math.max(1, ...this.state.stages.map((s) => (smap[s.id] || {}).count || 0));
            this.state.funnel = this.state.stages.map((s) => ({
                sid: s.id,
                name: s.name,
                count: (smap[s.id] || {}).count || 0,
                value: (smap[s.id] || {}).value || 0,
                pct: Math.round(((smap[s.id] || {}).count || 0) / maxCount * 100),
            }));

            const byUS = await this.orm.readGroup("crm.lead", base,
                ["user_id", "stage_id", "expected_revenue:sum"], ["user_id", "stage_id"]);
            const wonByU = await this.orm.readGroup("crm.lead", [...base, ["probability", "=", 100]],
                ["user_id"], ["user_id"]);
            const lostByU = await this.orm.readGroup("crm.lead",
                [["type","=","opportunity"],["active","=",false],
                 ["date_closed",">=",dFrom],["date_closed","<=",dTo],...uF],
                ["user_id"], ["user_id"]);
            const movedDomain = [
                ["type","=","opportunity"],["active","=",true],
                ["date_last_stage_update",">=",dFrom],["date_last_stage_update","<=",dTo],...uF,
            ];
            if (this.state.stages.length) movedDomain.push(["stage_id", "!=", this.state.stages[0].id]);
            const movedByU = await this.orm.readGroup("crm.lead", movedDomain, ["user_id"], ["user_id"]);

            const wonMap   = Object.fromEntries(wonByU.filter((r) => r.user_id).map((r) => [r.user_id[0], r.user_id_count || 0]));
            const lostMap  = Object.fromEntries(lostByU.filter((r) => r.user_id).map((r) => [r.user_id[0], r.user_id_count || 0]));
            const movedMap = Object.fromEntries(movedByU.filter((r) => r.user_id).map((r) => [r.user_id[0], r.user_id_count || 0]));

            const allLeads = await this.orm.searchRead("crm.lead", base,
                ["user_id", "create_date", "date_last_stage_update"], { limit: 500 });
            const daysSum = {}; const daysCnt = {};
            for (const l of allLeads) {
                if (!l.user_id || !l.create_date || !l.date_last_stage_update) continue;
                const uid = l.user_id[0];
                const days = (new Date(l.date_last_stage_update) - new Date(l.create_date)) / 86400000;
                if (days > 0 && days < 365) {
                    daysSum[uid] = (daysSum[uid] || 0) + days;
                    daysCnt[uid] = (daysCnt[uid] || 0) + 1;
                }
            }

            const umap = {};
            for (const r of byUS) {
                if (!r.user_id) continue;
                const uid = r.user_id[0];
                if (!umap[uid]) {
                    umap[uid] = { uid, name: r.user_id[1], total: 0, won: wonMap[uid] || 0,
                        lost: lostMap[uid] || 0, moved: movedMap[uid] || 0, pipe: 0,
                        stuck: 0, stages: {},
                        avgDays: daysCnt[uid] ? Math.round(daysSum[uid] / daysCnt[uid] * 10) / 10 : null };
                }
                umap[uid].total += r.user_id_count || 0;
                umap[uid].pipe  += r.expected_revenue || 0;
                if (r.stage_id) umap[uid].stages[r.stage_id[1]] = r.user_id_count || 0;
            }

            if (this.state.stages.length) {
                const stuckByU = await this.orm.readGroup("crm.lead",
                    [...base, ["stage_id", "=", this.state.stages[0].id]],
                    ["user_id"], ["user_id"]);
                for (const r of stuckByU) {
                    if (r.user_id && umap[r.user_id[0]]) {
                        umap[r.user_id[0]].stuck = r.user_id_count || 0;
                    }
                }
            }

            for (const u of Object.values(umap)) {
                u.winpct = u.total ? Math.round(u.won / u.total * 100) : 0;
            }

            this.state.breakdown = Object.values(umap).sort((a, b) => b.total - a.total);

            const activeUids = new Set(Object.keys(umap).map(Number));
            this.state.inactive = this.state.salespersons.filter((sp) => !activeUids.has(sp.id));
            this.state.noMoves = Object.values(umap).filter((u) => u.total > 0 && u.moved === 0);

            const lostRG = await this.orm.readGroup("crm.lead",
                [["type","=","opportunity"],["active","=",false],
                 ["date_closed",">=",dFrom],["date_closed","<=",dTo],...uF],
                ["lost_reason_id"], ["lost_reason_id"]);
            const maxLost = Math.max(1, ...lostRG.map((r) => r.lost_reason_id_count || 0));
            this.state.lostReasons = lostRG.map((r) => ({
                id: r.lost_reason_id ? r.lost_reason_id[0] : 0,
                name: r.lost_reason_id ? r.lost_reason_id[1] : "No Reason",
                count: r.lost_reason_id_count || 0,
                pct: Math.round((r.lost_reason_id_count || 0) / maxLost * 100),
            })).sort((a, b) => b.count - a.count);

            const recent = await this.orm.searchRead("crm.lead",
                [["type","=","opportunity"],["date_last_stage_update",">=",dFrom],
                 ["date_last_stage_update","<=",dTo],...uF],
                ["name","user_id","stage_id","date_last_stage_update","active","probability"],
                { order: "date_last_stage_update desc", limit: 15 });
            this.state.activity = recent.map((r) => ({
                id: r.id,
                name: r.name,
                user: r.user_id ? r.user_id[1] : "?",
                stage: r.stage_id ? r.stage_id[1] : "?",
                when: r.date_last_stage_update,
                lost: !r.active && r.probability === 0,
            }));

            this.state.error = null;
            this.state.updated = new Date().toLocaleTimeString();
        } catch (e) {
            this.state.error = e.message || String(e);
            console.error("Dashboard fetch error:", e);
        } finally {
            this.state.loading = false;
        }
    }

    onYesterday()  { this.state.period = "yesterday";  this.state.loading = true; this._fetch(); }
    onToday()      { this.state.period = "today";      this.state.loading = true; this._fetch(); }
    onLastWeek()   { this.state.period = "last_week";  this.state.loading = true; this._fetch(); }
    onLastMonth()  { this.state.period = "last_month"; this.state.loading = true; this._fetch(); }
    onCustom()     { this.state.period = "custom"; }
    onDateFrom(ev) { this.state.dateFrom = ev.target.value; }
    onDateTo(ev)   { this.state.dateTo = ev.target.value; this.state.loading = true; this._fetch(); }
    onRefresh()    { this.state.loading = true; this._fetch(); }

    toggleUser(id) {
        const ids = [...this.state.userIds];
        const i = ids.indexOf(id);
        if (i >= 0) ids.splice(i, 1); else ids.push(id);
        this.state.userIds = ids;
        this.state.loading = true;
        this._fetch();
    }

    tabOverview() { this.state.tab = "overview"; }
    tabFunnel()   { this.state.tab = "funnel"; }
    tabTeam()     { this.state.tab = "team"; }
    tabLost()     { this.state.tab = "lost"; }
    tabInactive() { this.state.tab = "inactive"; }
    tabActivity() { this.state.tab = "activity"; }

    kpiTotal() { this._openLeads([["active", "=", true]]); }
    kpiStuck() {
        if (this.state.stages.length) {
            this._openLeads([["stage_id", "=", this.state.stages[0].id], ["active", "=", true]]);
        }
    }
    kpiWon()  { this._openLeads([["probability", "=", 100], ["active", "=", true]]); }
    kpiLost() { this._openLost(false); }

    _getBaseDomain() {
        const [df, dt] = this._getRange();
        const d = [
            ["type", "=", "opportunity"],
            ["create_date", ">=", df + " 00:00:00"],
            ["create_date", "<=", dt + " 23:59:59"],
        ];
        if (this.state.userIds.length) d.push(["user_id", "in", this.state.userIds]);
        return d;
    }

    _openLeads(extra) {
        const domain = [...this._getBaseDomain(), ...(extra || [])];
        this.action.doAction({
            type: "ir.actions.act_window",
            name: "Opportunities",
            res_model: "crm.lead",
            view_mode: "list,form",
            views: [[false, "list"], [false, "form"]],
            domain,
        });
    }

    _openLost(userId) {
        const [df, dt] = this._getRange();
        const domain = [
            ["type", "=", "opportunity"], ["active", "=", false],
            ["date_closed", ">=", df + " 00:00:00"],
            ["date_closed", "<=", dt + " 23:59:59"],
        ];
        if (userId) domain.push(["user_id", "=", userId]);
        this.action.doAction({
            type: "ir.actions.act_window",
            name: "Lost Opportunities",
            res_model: "crm.lead",
            view_mode: "list,form",
            views: [[false, "list"], [false, "form"]],
            domain,
            context: { active_test: false },
        });
    }

    goUserOpps(uid)  { this._openLeads([["user_id", "=", uid], ["active", "=", true]]); }
    goUserWon(uid)   { this._openLeads([["user_id", "=", uid], ["probability", "=", 100]]); }
    goUserLost(uid)  { this._openLost(uid); }
    goUserStuck(uid) {
        if (this.state.stages.length) {
            this._openLeads([["user_id", "=", uid], ["stage_id", "=", this.state.stages[0].id], ["active", "=", true]]);
        }
    }
    goStage(sid) { this._openLeads([["stage_id", "=", sid], ["active", "=", true]]); }
    goInactive(uid) {
        this.action.doAction({
            type: "ir.actions.act_window",
            name: "Opportunities",
            res_model: "crm.lead",
            view_mode: "list,form",
            views: [[false, "list"], [false, "form"]],
            domain: [["type", "=", "opportunity"], ["active", "=", true], ["user_id", "=", uid]],
        });
    }
    goLostReason(rid) {
        const [df, dt] = this._getRange();
        const domain = [
            ["type","=","opportunity"],["active","=",false],
            ["date_closed",">=",df+" 00:00:00"],["date_closed","<=",dt+" 23:59:59"],
        ];
        if (rid) domain.push(["lost_reason_id", "=", rid]);
        this.action.doAction({
            type: "ir.actions.act_window",
            name: "Lost Opportunities",
            res_model: "crm.lead",
            view_mode: "list,form",
            views: [[false, "list"], [false, "form"]],
            domain,
            context: { active_test: false },
        });
    }
    goLead(id) {
        this.action.doAction({
            type: "ir.actions.act_window",
            res_model: "crm.lead",
            res_id: id,
            view_mode: "form",
            views: [[false, "form"]],
        });
    }

    onShare()    { this.state.showShare = true; this.state.shareDone = false; }
    closeShare() { this.state.showShare = false; }
    doShare() {
        const [df, dt] = this._getRange();
        const k = this.state.kpis;
        const rows = this.state.breakdown.map((u) =>
            `<tr><td>${u.name}</td><td>${u.total}</td><td>${u.moved}</td><td>${u.won}</td><td>${u.lost}</td><td>${u.winpct}%</td></tr>`
        ).join("");
        const body = `<h2>CRM Dashboard Report</h2>
<p>Period: <b>${df}</b> to <b>${dt}</b></p>
<p>Opportunities: ${k.total} | Won: ${k.won} | Lost: ${k.lost} | Stuck: ${k.stuck}</p>
<table border="1" cellpadding="6" style="border-collapse:collapse">
<tr><th>Name</th><th>Assigned</th><th>Advanced</th><th>Won</th><th>Lost</th><th>Win%</th></tr>
${rows}
</table>`;
        this.action.doAction({
            type: "ir.actions.act_window",
            res_model: "mail.compose.message",
            view_mode: "form",
            views: [[false, "form"]],
            target: "new",
            context: {
                default_subject: "CRM Dashboard Report " + df + " to " + dt,
                default_body: body,
            },
        });
        this.state.shareDone = true;
    }

    get stageLabels() { return this.state.funnel.map((s) => s.name); }
    get stageDatasets() {
        return [{
            label: "Opportunities",
            data: this.state.funnel.map((s) => s.count),
            backgroundColor: ["#4C9BE8","#36B37E","#FF8B00","#6554C0","#00B8D9","#FF5630","#57D9A3"],
            borderRadius: 6,
        }];
    }

    fmtM(v) {
        if (!v) return "$0";
        if (v >= 1000000) return "$" + (v / 1000000).toFixed(1) + "M";
        if (v >= 1000) return "$" + (v / 1000).toFixed(0) + "K";
        return "$" + Math.round(v);
    }

    timeAgo(dateStr) {
        if (!dateStr) return "";
        const diff = (new Date() - new Date(dateStr)) / 1000;
        if (diff < 60) return Math.round(diff) + "s ago";
        if (diff < 3600) return Math.round(diff / 60) + "m ago";
        if (diff < 86400) return Math.round(diff / 3600) + "h ago";
        return Math.round(diff / 86400) + "d ago";
    }
}

registry.category("actions").add("crm_live_dashboard", CrmLiveDashboard);
