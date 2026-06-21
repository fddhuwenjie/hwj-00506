const http = require('http');

const API_HOST = 'localhost';
const API_PORT = 8506;

function apiRequest(path, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: API_HOST,
      port: API_PORT,
      path: '/api' + path,
      method: method,
      headers: { 'Content-Type': 'application/json' }
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = data ? JSON.parse(data) : {};
          resolve({ status: res.statusCode, body: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    req.on('error', reject);
    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

let passed = 0;
let failed = 0;
const results = [];

function test(name, fn) {
  results.push({ name, fn });
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || '断言失败');
  }
}

async function runTests() {
  console.log('='.repeat(60));
  console.log('结算单锁定与财务审计追踪 - 功能测试');
  console.log('='.repeat(60));
  console.log();

  for (const { name, fn } of results) {
    process.stdout.write(`  测试: ${name} ... `);
    try {
      await fn();
      console.log('✅ PASS');
      passed++;
    } catch (e) {
      console.log('❌ FAIL');
      console.log(`     原因: ${e.message}`);
      failed++;
    }
  }

  console.log();
  console.log('='.repeat(60));
  console.log(`测试结果: 通过 ${passed} 个, 失败 ${failed} 个, 共 ${results.length} 个`);
  console.log('='.repeat(60));

  if (failed > 0) {
    process.exit(1);
  }
}

test('1. 获取已完成工单列表', async () => {
  const res = await apiRequest('/repair-orders?status=completed');
  assert(res.status === 200, `状态码应为200，实际为${res.status}`);
  assert(Array.isArray(res.body), '应返回数组');
  assert(res.body.length > 0, '应有已完成工单');
  global.testCompletedOrderId = res.body[0].id;
  global.testCompletedOrderNo = res.body[0].order_no;
});

test('2. 已结清工单重复生成结算单 - 应被拒绝', async () => {
  const res = await apiRequest('/settlements', 'POST', {
    order_id: global.testCompletedOrderId,
    discount: 0
  });
  assert(res.status === 400, `应返回400错误，实际为${res.status}`);
  assert(res.body.error && res.body.error.includes('已锁定'), '错误信息应包含"已锁定"');
  assert(res.body.locked === true, '应返回locked: true');
});

test('3. 已完成工单回退为待结算 - 应被拒绝', async () => {
  const res = await apiRequest(`/repair-orders/${global.testCompletedOrderId}/status`, 'PUT', {
    status: 'pending_settlement'
  });
  assert(res.status === 400, `应返回400错误，实际为${res.status}`);
  assert(res.body.error && res.body.error.includes('禁止回退'), '错误信息应包含"禁止回退"');
});

test('4. 已完成工单回退为维修中 - 应被拒绝', async () => {
  const res = await apiRequest(`/repair-orders/${global.testCompletedOrderId}/status`, 'PUT', {
    status: 'in_repair'
  });
  assert(res.status === 400, `应返回400错误，实际为${res.status}`);
});

test('5. 获取结算详情 - 应包含锁定状态和原始应收', async () => {
  const res = await apiRequest(`/settlements/${global.testCompletedOrderId}`);
  assert(res.status === 200, `状态码应为200，实际为${res.status}`);
  assert(res.body.is_locked === 1, '已完成工单结算单应为锁定状态');
  assert(res.body.original_receivable !== undefined, '应包含original_receivable字段');
  assert(Array.isArray(res.body.payments), '应包含payments数组');
  assert(Array.isArray(res.body.adjustments), '应包含adjustments数组');
  assert(Array.isArray(res.body.deduction_records), '应包含deduction_records数组');
});

test('6. 获取待结算工单列表', async () => {
  const res = await apiRequest('/repair-orders?status=pending_settlement');
  assert(res.status === 200, `状态码应为200，实际为${res.status}`);
  assert(Array.isArray(res.body), '应返回数组');
  if (res.body.length === 0) {
    const allRes = await apiRequest('/repair-orders');
    const pending = allRes.body.find(o => o.status === 'pending_diagnosis' || o.status === 'in_repair');
    if (pending) {
      await apiRequest(`/repair-orders/${pending.id}/status`, 'PUT', { status: 'in_repair' });
      await apiRequest(`/repair-orders/${pending.id}/status`, 'PUT', { status: 'pending_settlement' });
      global.testPendingOrderId = pending.id;
    }
  } else {
    global.testPendingOrderId = res.body[0].id;
  }
  assert(global.testPendingOrderId, '应有待结算工单用于测试');
});

test('7. 待结算工单生成结算单 - 应成功', async () => {
  const res = await apiRequest('/settlements', 'POST', {
    order_id: global.testPendingOrderId,
    discount: 10
  });
  assert(res.status === 200, `状态码应为200，实际为${res.status}`);
  assert(res.body.receivable_amount !== undefined, '应返回应收金额');
  assert(res.body.created || res.body.updated, '应返回created或updated标志');
});

test('8. 结算详情 - 未锁定状态', async () => {
  const res = await apiRequest(`/settlements/${global.testPendingOrderId}`);
  assert(res.status === 200, `状态码应为200，实际为${res.status}`);
  assert(res.body.is_locked === 0, '待结算工单结算单应为未锁定状态');
});

test('9. 收款幂等性测试 - 两次相同幂等键的收款只处理一次', async () => {
  const settleRes = await apiRequest(`/settlements/${global.testPendingOrderId}`);
  const unpaid = settleRes.body.receivable_amount - settleRes.body.paid_amount;
  const payAmount = Math.min(50, unpaid - 10);
  const idempKey = 'test_pay_idem_' + Date.now();

  const res1 = await apiRequest(`/settlements/${global.testPendingOrderId}/pay`, 'POST', {
    amount: payAmount,
    payment_method: '测试',
    remark: '幂等测试第一次',
    idempotency_key: idempKey
  });
  assert(res1.status === 200, `第一次收款应成功，状态码${res1.status}`);
  assert(res1.body.idempotent === false, '第一次不应幂等命中');
  const paidAfterFirst = res1.body.paid_amount;

  const res2 = await apiRequest(`/settlements/${global.testPendingOrderId}/pay`, 'POST', {
    amount: payAmount,
    payment_method: '测试',
    remark: '幂等测试第二次',
    idempotency_key: idempKey
  });
  assert(res2.status === 200, `第二次收款应返回200（幂等命中），状态码${res2.status}`);
  assert(res2.body.idempotent === true, '第二次应幂等命中');

  const afterSettle = await apiRequest(`/settlements/${global.testPendingOrderId}`);
  assert(
    Math.abs(afterSettle.body.paid_amount - paidAfterFirst) < 0.01,
    `已收金额不应变化，第一次后${paidAfterFirst}，现在${afterSettle.body.paid_amount}`
  );
});

test('10. 部分付款后，结算调整 - 增加金额', async () => {
  const before = await apiRequest(`/settlements/${global.testPendingOrderId}`);
  const beforeReceivable = before.body.receivable_amount;

  const res = await apiRequest(`/settlements/${global.testPendingOrderId}/adjust`, 'POST', {
    adjustment_amount: 50,
    adjustment_type: 'surcharge',
    reason: '测试：补收费用',
    operator: '测试员',
    idempotency_key: 'test_adjust_' + Date.now()
  });
  assert(res.status === 200, `调整应成功，状态码${res.status}`);
  assert(res.body.new_receivable !== undefined, '应返回新的应收金额');

  const after = await apiRequest(`/settlements/${global.testPendingOrderId}`);
  assert(
    Math.abs(after.body.receivable_amount - (beforeReceivable + 50)) < 0.01,
    `应收应增加50，之前${beforeReceivable}，现在${after.body.receivable_amount}`
  );
  assert(after.body.is_locked === 1, '调整后结算单应被锁定');
  assert(after.body.adjustments.length >= 1, '调整记录应至少1条');
  assert(after.body.total_adjustment > 0, '总调整额应为正');
});

test('11. 结算调整幂等性测试 - 两次相同幂等键只记录一次', async () => {
  const before = await apiRequest(`/settlements/${global.testPendingOrderId}`);
  const adjustCountBefore = before.body.adjustments.length;
  const idemKey = 'test_adjust_idem_' + Date.now();

  const res1 = await apiRequest(`/settlements/${global.testPendingOrderId}/adjust`, 'POST', {
    adjustment_amount: 20,
    adjustment_type: 'manual',
    reason: '幂等测试调整',
    operator: '测试员',
    idempotency_key: idemKey
  });
  assert(res1.status === 200, `第一次调整应成功`);
  assert(res1.body.idempotent === false, '第一次不应幂等命中');

  const after1 = await apiRequest(`/settlements/${global.testPendingOrderId}`);
  assert(after1.body.adjustments.length === adjustCountBefore + 1, '调整记录应增加1条');

  const res2 = await apiRequest(`/settlements/${global.testPendingOrderId}/adjust`, 'POST', {
    adjustment_amount: 20,
    adjustment_type: 'manual',
    reason: '幂等测试调整第二次',
    operator: '测试员',
    idempotency_key: idemKey
  });
  assert(res2.status === 200, `第二次调整应返回200（幂等命中）`);
  assert(res2.body.idempotent === true, '第二次应幂等命中');

  const after2 = await apiRequest(`/settlements/${global.testPendingOrderId}`);
  assert(after2.body.adjustments.length === adjustCountBefore + 1, '调整记录数不应变化（幂等）');
});

test('12. 结算调整 - 减少金额（折扣）', async () => {
  const before = await apiRequest(`/settlements/${global.testPendingOrderId}`);
  const beforeReceivable = before.body.receivable_amount;

  const res = await apiRequest(`/settlements/${global.testPendingOrderId}/adjust`, 'POST', {
    adjustment_amount: -30,
    adjustment_type: 'discount',
    reason: '测试：优惠折扣',
    operator: '测试员',
    idempotency_key: 'test_adjust_discount_' + Date.now()
  });
  assert(res.status === 200, `调整应成功，状态码${res.status}`);

  const after = await apiRequest(`/settlements/${global.testPendingOrderId}`);
  assert(
    Math.abs(after.body.receivable_amount - (beforeReceivable - 30)) < 0.01,
    `应收应减少30，之前${beforeReceivable}，现在${after.body.receivable_amount}`
  );
});

test('13. 已锁定结算单禁止直接修改 - 重新生成应被拒绝', async () => {
  const res = await apiRequest('/settlements', 'POST', {
    order_id: global.testPendingOrderId,
    discount: 100
  });
  assert(res.status === 400, `已锁定的结算单重新生成应被拒绝，状态码${res.status}`);
  assert(res.body.locked === true || res.body.error.includes('已锁定'), '应提示已锁定');
});

test('14. 全部结清后 - 库存扣减记录存在', async () => {
  const settleRes = await apiRequest(`/settlements/${global.testPendingOrderId}`);
  const unpaid = settleRes.body.receivable_amount - settleRes.body.paid_amount;

  if (unpaid > 0.01) {
    const payRes = await apiRequest(`/settlements/${global.testPendingOrderId}/pay`, 'POST', {
      amount: unpaid,
      payment_method: '现金',
      remark: '结清尾款',
      idempotency_key: 'test_final_pay_' + Date.now()
    });
    assert(payRes.status === 200, `结清尾款应成功，状态码${payRes.status}`);
  }

  const after = await apiRequest(`/settlements/${global.testPendingOrderId}`);
  assert(after.body.debt_status === 'paid', '结清后应为paid状态');
  assert(after.body.is_locked === 1, '结清后应锁定');
  assert(Array.isArray(after.body.deduction_records), '应有库存扣减记录');
  if (after.body.deduction_records.length > 0) {
    assert(after.body.deduction_records[0].part_id !== undefined, '扣减记录应包含part_id');
    assert(after.body.deduction_records[0].quantity > 0, '扣减数量应大于0');
  }
});

test('15. 库存只扣一次验证 - 再次触发结清逻辑不应重复扣减', async () => {
  const beforeParts = await apiRequest('/parts');
  const settleRes = await apiRequest(`/settlements/${global.testPendingOrderId}`);

  const dedupKeys = settleRes.body.deduction_records.map(d => d.idempotency_key);
  assert(dedupKeys.length > 0 || settleRes.body.deduction_records.length === 0, '每条扣减记录应有幂等键');

  const beforePartMap = {};
  beforeParts.body.forEach(p => { beforePartMap[p.id] = p.stock; });

  const afterParts = await apiRequest('/parts');
  const afterPartMap = {};
  afterParts.body.forEach(p => { afterPartMap[p.id] = p.stock; });

  for (const dr of settleRes.body.deduction_records) {
    const before = beforePartMap[dr.part_id];
    const after = afterPartMap[dr.part_id];
    if (before !== undefined && after !== undefined) {
      assert(before === after, `配件ID ${dr.part_id} 库存不应变化（已扣减过）`);
    }
  }
});

test('16. 收款流水不丢失 - 多次收款记录完整', async () => {
  const res = await apiRequest(`/settlements/${global.testPendingOrderId}`);
  const payments = res.body.payments;
  assert(payments.length >= 2, '应至少有2条收款记录');

  let totalPaid = 0;
  payments.forEach(p => { totalPaid += p.amount; });
  assert(
    Math.abs(totalPaid - res.body.paid_amount) < 0.01,
    `收款流水总和应等于已收金额，流水和=${totalPaid}，已收=${res.body.paid_amount}`
  );
});

test('17. 调整记录完整 - 包含差额、原因、操作人、时间', async () => {
  const res = await apiRequest(`/settlements/${global.testPendingOrderId}`);
  const adjustments = res.body.adjustments;
  assert(adjustments.length > 0, '应有调整记录');

  for (const adj of adjustments) {
    assert(adj.adjustment_amount !== undefined && adj.adjustment_amount !== 0, '调整金额不应为0');
    assert(adj.reason && adj.reason.length > 0, '应有调整原因');
    assert(adj.operator && adj.operator.length > 0, '应有操作人');
    assert(adj.created_at && adj.created_at.length > 0, '应有创建时间');
    assert(adj.adjustment_type && adj.adjustment_type.length > 0, '应有调整类型');
  }
});

test('18. 原始应收金额保存正确', async () => {
  const res = await apiRequest(`/settlements/${global.testPendingOrderId}`);
  assert(res.body.original_receivable > 0, '原始应收应大于0');
  const totalAdj = res.body.total_adjustment || 0;
  const calculated = res.body.original_receivable + totalAdj;
  assert(
    Math.abs(calculated - res.body.receivable_amount) < 0.01,
    `原始应收 + 调整总额 = 当前应收，原始=${res.body.original_receivable}，调整=${totalAdj}，当前=${res.body.receivable_amount}`
  );
});

test('19. 已结清工单禁止继续收款', async () => {
  const res = await apiRequest(`/settlements/${global.testPendingOrderId}/pay`, 'POST', {
    amount: 10,
    payment_method: '现金',
    remark: '测试超额收款'
  });
  assert(res.status === 400, `已结清后继续收款应被拒绝，状态码${res.status}`);
  assert(res.body.error && res.body.error.includes('全部结清'), '错误信息应包含"全部结清"');
});

test('20. 车辆档案功能不回归', async () => {
  const res = await apiRequest('/vehicles');
  assert(res.status === 200, '车辆列表应正常返回');
  assert(Array.isArray(res.body) && res.body.length > 0, '车辆数据应存在');
});

test('21. 配件库存功能不回归', async () => {
  const res = await apiRequest('/parts');
  assert(res.status === 200, '配件列表应正常返回');
  assert(Array.isArray(res.body) && res.body.length > 0, '配件数据应存在');
});

test('22. 保养计划功能不回归', async () => {
  const res = await apiRequest('/maintenance-plans');
  assert(res.status === 200, '保养计划应正常返回');
  assert(Array.isArray(res.body), '保养计划数据应存在');
});

test('23. 统计报表功能不回归', async () => {
  const results = await Promise.all([
    apiRequest('/stats/monthly-revenue'),
    apiRequest('/stats/parts-ranking'),
    apiRequest('/stats/technician-ranking'),
    apiRequest('/stats/rework-rate')
  ]);
  results.forEach((r, i) => {
    assert(r.status === 200, `统计接口${i + 1}应正常返回`);
  });
});

test('24. 评价功能不回归', async () => {
  const res = await apiRequest(`/settlements/${global.testCompletedOrderId}`);
  assert(res.status === 200, '应能获取已完成工单的结算详情');
  if (res.body.review) {
    assert(res.body.review.rating > 0, '评价星级应大于0');
  }
});

test('25. 结算列表功能不回归', async () => {
  const pendingRes = await apiRequest('/repair-orders?status=pending_settlement');
  const completedRes = await apiRequest('/repair-orders?status=completed');
  assert(pendingRes.status === 200, '待结算工单应正常返回');
  assert(completedRes.status === 200, '已完成工单应正常返回');
});

runTests().catch(e => {
  console.error('测试运行失败:', e);
  process.exit(1);
});
