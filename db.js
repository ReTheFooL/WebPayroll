/**
 * WebPayroll — Database Layer (IndexedDB)
 * โครงสร้างตรงกับ webpayroll.sql ทุก table
 */

const DB_NAME    = 'WebPayrollDB';
const DB_VERSION = 1;

let _db = null;

const STORES = [
    { name: 'companies',              keyPath: 'id', indexes: ['code'] },
    { name: 'departments',            keyPath: 'id', indexes: ['company_id'] },
    { name: 'divisions',              keyPath: 'id', indexes: ['department_id'] },
    { name: 'employees',              keyPath: 'id', indexes: ['company_id', 'department_id', 'division_id', 'employee_code'] },
    { name: 'income_types',           keyPath: 'id', indexes: ['name'] },
    { name: 'deduction_types',        keyPath: 'id', indexes: ['name'] },
    { name: 'payroll_periods',        keyPath: 'id', indexes: ['company_id'] },
    { name: 'payroll_entries',        keyPath: 'id', indexes: ['period_id', 'employee_id'] },
    { name: 'payroll_income_items',   keyPath: 'id', indexes: ['entry_id'] },
    { name: 'payroll_deduction_items',keyPath: 'id', indexes: ['entry_id'] },
    { name: 'tax_allowances',         keyPath: 'id', indexes: ['employee_id', 'tax_year'] },
];

function openDB() {
    return new Promise((resolve, reject) => {
        if (_db) return resolve(_db);
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = e => {
            const db = e.target.result;
            STORES.forEach(s => {
                if (!db.objectStoreNames.contains(s.name)) {
                    const store = db.createObjectStore(s.name, { keyPath: s.keyPath, autoIncrement: true });
                    s.indexes.forEach(idx => store.createIndex(idx, idx));
                }
            });
        };
        req.onsuccess  = e => { _db = e.target.result; resolve(_db); };
        req.onerror    = e => reject(e.target.error);
    });
}

function tx(storeName, mode = 'readonly') {
    return _db.transaction(storeName, mode).objectStore(storeName);
}

function all(storeName) {
    return new Promise((resolve, reject) => {
        const req = tx(storeName).getAll();
        req.onsuccess = e => resolve(e.target.result);
        req.onerror   = e => reject(e.target.error);
    });
}

function get(storeName, id) {
    return new Promise((resolve, reject) => {
        const req = tx(storeName).get(id);
        req.onsuccess = e => resolve(e.target.result);
        req.onerror   = e => reject(e.target.error);
    });
}

function getByIndex(storeName, indexName, value) {
    return new Promise((resolve, reject) => {
        const req = tx(storeName).index(indexName).getAll(value);
        req.onsuccess = e => resolve(e.target.result);
        req.onerror   = e => reject(e.target.error);
    });
}

function put(storeName, record) {
    return new Promise((resolve, reject) => {
        const now = new Date().toISOString();
        const data = { ...record, updated_at: now };
        if (!data.created_at) data.created_at = now;
        const req = tx(storeName, 'readwrite').put(data);
        req.onsuccess = e => resolve(e.target.result);
        req.onerror   = e => reject(e.target.error);
    });
}

function remove(storeName, id) {
    return new Promise((resolve, reject) => {
        const req = tx(storeName, 'readwrite').delete(id);
        req.onsuccess = e => resolve(true);
        req.onerror   = e => reject(e.target.error);
    });
}

async function seed() {
    const companies = await all('companies');
    if (companies.length > 0) return; // already seeded

    // Master data
    const incomeTypes = ['เงินเดือน','ค่าล่วงเวลา (OT)','โบนัส','ค่าเดินทาง','ค่าที่พัก'];
    for (const name of incomeTypes) await put('income_types', { name, taxable: !['ค่าเดินทาง','ค่าที่พัก'].includes(name) ? 1 : 0 });

    const deductionTypes = ['ประกันสังคม','กองทุนสำรองเลี้ยงชีพ','ภาษีหัก ณ ที่จ่าย','เงินกู้','อื่นๆ'];
    for (const name of deductionTypes) await put('deduction_types', { name });

    // Sample company + structure
    const cid = await put('companies', { code: 'C001', name: 'บริษัทตัวอย่าง จำกัด' });
    const dept1 = await put('departments', { company_id: cid, name: 'ฝ่ายบุคคล' });
    const dept2 = await put('departments', { company_id: cid, name: 'ฝ่ายบัญชี' });
    const dept3 = await put('departments', { company_id: cid, name: 'ฝ่ายไอที' });
    const div1  = await put('divisions',   { department_id: dept2, name: 'แผนกเงินเดือน' });
    const div2  = await put('divisions',   { department_id: dept3, name: 'แผนกพัฒนาระบบ' });

    const emps = [
        { employee_code: 'EMP001', full_name: 'สมชาย ใจดี',        position: 'ผู้จัดการ',     employee_type: 'ประจำ',   start_date: '2022-01-01', first_payment: 45000, installments_per_year: 12, company_id: cid, department_id: dept2, division_id: div1 },
        { employee_code: 'EMP002', full_name: 'นฤเบศร์ สุขใจ',     position: 'นักพัฒนา',     employee_type: 'ประจำ',   start_date: '2023-03-15', first_payment: 35000, installments_per_year: 12, company_id: cid, department_id: dept3, division_id: div2 },
        { employee_code: 'EMP003', full_name: 'ปรียานุช แสงทอง',   position: 'เจ้าหน้าที่',  employee_type: 'สัญญาจ้าง', start_date: '2024-06-01', first_payment: 25000, installments_per_year: 12, company_id: cid, department_id: dept1, division_id: null },
    ];
    for (const emp of emps) await put('employees', { ...emp, is_active: 1 });
}

// ── High-level API ─────────────────────────────────────────

async function getEmployees(filters = {}) {
    let rows = await all('employees');
    if (filters.company_id)    rows = rows.filter(e => e.company_id    == filters.company_id);
    if (filters.department_id) rows = rows.filter(e => e.department_id == filters.department_id);
    if (filters.division_id)   rows = rows.filter(e => e.division_id   == filters.division_id);
    if (filters.employee_type) rows = rows.filter(e => e.employee_type === filters.employee_type);
    if (filters.search) {
        const q = filters.search.toLowerCase();
        rows = rows.filter(e => e.full_name.toLowerCase().includes(q) || e.employee_code.toLowerCase().includes(q));
    }
    return rows.filter(e => e.is_active !== 0);
}

async function saveEmployee(data) {
    return put('employees', data);
}

async function getOrCreateEntry(period_id, employee_id) {
    const entries = await all('payroll_entries');
    const existing = entries.find(e => e.period_id == period_id && e.employee_id == employee_id);
    if (existing) return existing;
    const id = await put('payroll_entries', { period_id, employee_id, total_income: 0, total_deduction: 0, total_allowance: 0, net_income: 0, tax_amount: 0 });
    return get('payroll_entries', id);
}

async function saveIncomeItems(entry_id, items) {
    // remove old
    const old = await getByIndex('payroll_income_items', 'entry_id', entry_id);
    for (const o of old) await remove('payroll_income_items', o.id);
    // insert new
    for (let i = 0; i < items.length; i++) {
        await put('payroll_income_items', { entry_id, ...items[i], sort_order: i });
    }
}

async function saveDeductionItems(entry_id, items) {
    const old = await getByIndex('payroll_deduction_items', 'entry_id', entry_id);
    for (const o of old) await remove('payroll_deduction_items', o.id);
    for (let i = 0; i < items.length; i++) {
        await put('payroll_deduction_items', { entry_id, ...items[i], sort_order: i });
    }
}

async function saveTaxAllowances(employee_id, tax_year, data) {
    const all_rows = await all('tax_allowances');
    const existing = all_rows.find(r => r.employee_id == employee_id && r.tax_year == tax_year);
    const record = { ...(existing || {}), employee_id, tax_year, ...data };
    return put('tax_allowances', record);
}

async function getTaxAllowances(employee_id, tax_year) {
    const rows = await all('tax_allowances');
    return rows.find(r => r.employee_id == employee_id && r.tax_year == tax_year) || null;
}

async function getEntryFull(period_id, employee_id) {
    const entries = await all('payroll_entries');
    const entry = entries.find(e => e.period_id == period_id && e.employee_id == employee_id);
    if (!entry) return null;
    const income_items    = await getByIndex('payroll_income_items',    'entry_id', entry.id);
    const deduction_items = await getByIndex('payroll_deduction_items', 'entry_id', entry.id);
    return { ...entry, income_items, deduction_items };
}

async function getDepartments(company_id) {
    return getByIndex('departments', 'company_id', company_id);
}

async function getDivisions(department_id) {
    return getByIndex('divisions', 'department_id', department_id);
}

async function exportAll() {
    const data = {};
    for (const s of STORES) data[s.name] = await all(s.name);
    return data;
}

async function importAll(data) {
    for (const s of STORES) {
        if (!data[s.name]) continue;
        const store = _db.transaction(s.name, 'readwrite').objectStore(s.name);
        await new Promise(r => { store.clear().onsuccess = r; });
        for (const row of data[s.name]) await put(s.name, row);
    }
}

window.DB = { openDB, seed, all, get, put, remove, getByIndex, getEmployees, saveEmployee, getOrCreateEntry, saveIncomeItems, saveDeductionItems, saveTaxAllowances, getTaxAllowances, getEntryFull, getDepartments, getDivisions, exportAll, importAll };
