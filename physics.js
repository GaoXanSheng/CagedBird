/* 笼中物理（cannon-es）：页面与 Node 回归测试共用同一套搭建代码。
   笼子是动力学 compound，经点约束悬挂在树枝锚点 —— 摆动来自真实重力，
   自转由角速度目标平滑驱动。
   封闭性由碰撞体几何保证：地板 + 连续内壁圆筒 + 穹顶锥壳拼成全封闭壳体，
   物品在物理上无法离开笼子（不依赖任何手写位置钳制）。 */
import * as CANNON from 'cannon-es';

export const CAGE = {
  pivotLocalY: 4,      // 悬挂枢轴高度（笼底中心局部系）= 链长 + 顶环
  barCount: 16,
  barR: 1,
  barH: 2,
  baseY: 0.1,             // 笼底板顶面
  wallR: 1.17,            // 不可见连续内壁半径（栏杆外侧一点，堵住间隙）
};

export function createPhysics({ origin = { x: 0, y: 0, z: 0 }, gravity = -9.0 } = {}) {
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, gravity, 0) });
  world.broadphase = new CANNON.NaiveBroadphase(world);   // 4 体场景：朴素配对零漏检，且不受反复挂载/摘除影响
  world.solver.iterations = 12;
  world.defaultContactMaterial.friction = 0.4;
  world.defaultContactMaterial.restitution = 0.3;

  const matItem = new CANNON.Material('item');
  const matCage = new CANNON.Material('cage');
  world.addContactMaterial(new CANNON.ContactMaterial(matItem, matCage, { friction: 0.55, restitution: 0.38 }));
  world.addContactMaterial(new CANNON.ContactMaterial(matItem, matItem, { friction: 0.4, restitution: 0.3 }));

  /* 笼子：动力学 compound（底盘 / 栏杆 / 内壁 / 穹顶锥壳 / 顶盖），质心即体原点 */
  const cageBody = new CANNON.Body({
    mass: 6, material: matCage,
    linearDamping: 0.05, angularDamping: 0.3, allowSleep: false,
  });
  cageBody.position.set(origin.x, origin.y, origin.z);
  cageBody.addShape(new CANNON.Box(new CANNON.Vec3(1.0, 0.05, 1.0)), new CANNON.Vec3(0, 0.05, 0));
  for (let i = 0; i < CAGE.barCount; i++) {
    const a = (i / CAGE.barCount) * Math.PI * 2;
    cageBody.addShape(
      new CANNON.Box(new CANNON.Vec3(0.03, CAGE.barH / 2, 0.03)),
      new CANNON.Vec3(Math.cos(a) * CAGE.barR, CAGE.baseY + CAGE.barH / 2, Math.sin(a) * CAGE.barR)
    );
  }
  /* 连续内壁：24 段 × 3 层拼成无缝圆筒（视觉栏杆间隙保留，物理上无洞） */
  for (let band = 0; band < 3; band++) {
    const wy = 0.55 + band * 0.55;
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      const q = new CANNON.Quaternion().setFromAxisAngle(new CANNON.Vec3(0, 1, 0), -Math.PI / 2 - a);
      cageBody.addShape(
        new CANNON.Box(new CANNON.Vec3(0.35, 0.45, 0.15)),
        new CANNON.Vec3(Math.cos(a) * CAGE.wallR, wy, Math.sin(a) * CAGE.wallR),
        q
      );
    }
  }
  const slope = Math.atan2(0.82, 1.0);
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    /* 偏航对准方位 + 绕切向轴倾斜：16 段均分，宽轴保持水平切向 */
    const q = new CANNON.Quaternion().setFromAxisAngle(new CANNON.Vec3(0, 1, 0), -a)
      .mult(new CANNON.Quaternion().setFromAxisAngle(new CANNON.Vec3(0, 0, 1), slope));
    cageBody.addShape(
      new CANNON.Box(new CANNON.Vec3(0.12, 0.645, 0.28)),
      new CANNON.Vec3(Math.cos(a) * 0.62, 2.5, Math.sin(a) * 0.62),
      q
    );
  }
  cageBody.addShape(new CANNON.Box(new CANNON.Vec3(0.15, 0.08, 0.15)), new CANNON.Vec3(0, 2.98, 0));
  world.addBody(cageBody);

  /* 悬挂锚点（静态）+ 点约束：真实单摆，摆动衰减靠角阻尼 */
  const anchor = new CANNON.Body({ mass: 0 });
  anchor.position.set(origin.x, origin.y + CAGE.pivotLocalY, origin.z);
  world.addBody(anchor);
  world.addConstraint(new CANNON.PointToPointConstraint(
    cageBody, new CANNON.Vec3(0, CAGE.pivotLocalY, 0),
    anchor, new CANNON.Vec3(0, 0, 0)
  ));

  /* 扳手：手柄 + 头部 复合盒；幺鸡：单盒 */
  const wrenchBody = new CANNON.Body({
    mass: 0.5, material: matItem,
    linearDamping: 0.05, angularDamping: 0.12, allowSleep: false,
  });
  wrenchBody.addShape(new CANNON.Box(new CANNON.Vec3(0.712, 0.099, 0.048)), new CANNON.Vec3(-0.184, 0, 0));
  wrenchBody.addShape(new CANNON.Box(new CANNON.Vec3(0.24, 0.24, 0.05)), new CANNON.Vec3(0.696, 0.088, 0));
  world.addBody(wrenchBody);

  const tileBody = new CANNON.Body({
    mass: 0.2, material: matItem,
    linearDamping: 0.05, angularDamping: 0.12, allowSleep: false,
  });
  tileBody.addShape(new CANNON.Box(new CANNON.Vec3(0.31, 0.46, 0.21)));
  world.addBody(tileBody);

  /* 初始位姿（笼局部）：扳手斜卡在笼子中间——头部抵住栏杆/内壁（y≈1.3），
     尾部搭在笼底（参考图 2 姿态）；幺鸡平贴笼底（参考图 1） */
  function wrenchSpawn() {
    const phi = 56.25 * Math.PI / 180;
    const dir = new CANNON.Vec3(Math.cos(phi) * 0.55, 0.83, Math.sin(phi) * 0.55);
    dir.normalize();
    const q = new CANNON.Quaternion().setFromVectors(new CANNON.Vec3(1, 0, 0), dir);
    q.mult(new CANNON.Quaternion().setFromAxisAngle(new CANNON.Vec3(1, 0, 0), 50 * Math.PI / 180), q);
    const off = q.vmult(new CANNON.Vec3(0.696, 0.088, 0));
    const headC = new CANNON.Vec3(Math.cos(phi) * 0.76, 1.30, Math.sin(phi) * 0.76);
    return { p: headC.vsub(off), q };
  }
  const SPAWN = {
    wrench: wrenchSpawn(),
    tile: { p: new CANNON.Vec3(0.15, 0.62, 0.05), q: new CANNON.Quaternion().setFromEuler(-0.08, 0.5, 0) },
  };

  const _tmpV = new CANNON.Vec3();
  function resetBody(body, spawn) {          // 笼局部 → 世界（跟随当前笼位姿）
    cageBody.pointToWorldFrame(spawn.p, _tmpV);
    body.position.copy(_tmpV);
    cageBody.quaternion.mult(spawn.q, body.quaternion);
    cageBody.getVelocityAtWorldPoint(body.position, body.velocity);   // 跟随笼体运动
    body.angularVelocity.copy(cageBody.angularVelocity);
    body.wakeUp();
  }
  resetBody(wrenchBody, SPAWN.wrench);
  resetBody(tileBody, SPAWN.tile);

  /* 物品挂载管理：未选中的物品碰撞体不在物理世界里（切换 = 换碰撞箱）。
     摘除时把位姿记到笼局部系，重挂时按记忆原地放回——笼子怎么摆，
     物品都待在笼里原来的位置，绝不会在笼外凭空出现 */
  const _parked = new Map();
  function mountBody(body, on) {
    if (!on) {
      cageBody.pointToLocalFrame(body.position, _tmpV);
      _parked.set(body.id, {
        p: _tmpV.clone(),
        q: cageBody.quaternion.inverse().mult(body.quaternion),
      });
    }
    const i = world.bodies.indexOf(body);
    if (on) {
      const park = _parked.get(body.id);
      if (park) {
        cageBody.pointToWorldFrame(park.p, body.position);
        cageBody.quaternion.mult(park.q, body.quaternion);
        cageBody.getVelocityAtWorldPoint(body.position, body.velocity);
        body.angularVelocity.copy(cageBody.angularVelocity);
        body.wakeUp();
        _parked.delete(body.id);
      }
      if (world.bodies.indexOf(body) < 0) world.addBody(body);
    } else if (i >= 0) {
      world.removeBody(body);
    }
  }
  function setActiveItem(name) {
    mountBody(wrenchBody, name !== 'tile');
    mountBody(tileBody, name === 'tile');
  }
  setActiveItem('wrench');

  let spinTarget = 0;
  const VMAX = 25, WMAX = 30;                // 限速保险：拦下任何异常能量尖峰

  function step(dt) {
    cageBody.angularVelocity.y += (spinTarget - cageBody.angularVelocity.y) * Math.min(1, dt * 3);
    world.step(1 / 60, dt, 3);
    for (const b of [wrenchBody, tileBody]) {
      const v = b.velocity.length();
      if (v > VMAX) b.velocity.scale(VMAX / v, b.velocity);
      const w = b.angularVelocity.length();
      if (w > WMAX) b.angularVelocity.scale(WMAX / w, b.angularVelocity);
    }
  }

  function shake(active) {                   // 点击笼子：冲量推笼身，物品小幅受扰
    cageBody.wakeUp();
    const a = Math.random() * Math.PI * 2;
    const J = 4 + Math.random() * 4;
    cageBody.applyImpulse(new CANNON.Vec3(Math.cos(a) * J, 0, Math.sin(a) * J));
    const b = active === 'tile' ? tileBody : wrenchBody;
    b.wakeUp();
    b.applyImpulse(                          // 小幅扰动：物品主要随笼体晃动，而非各自乱飞
      new CANNON.Vec3((Math.random() * 2 - 1) * 0.35, 0.2 + Math.random() * 0.3, (Math.random() * 2 - 1) * 0.35),
      new CANNON.Vec3((Math.random() * 2 - 1) * 0.12, (Math.random() * 2 - 1) * 0.04, (Math.random() * 2 - 1) * 0.12)
    );
  }

  return {
    world, cageBody, wrenchBody, tileBody, SPAWN, resetBody, shake, step, setActiveItem,
    setSpin: on => { spinTarget = on ? 0.35 : 0; },
  };
}
