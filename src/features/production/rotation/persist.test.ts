import { describe, expect, it } from "vitest";
import { constraintsForSave } from "./personRules";
import {
  applyWorkerConstraintsMap,
  constraintsForPut,
  mergeWorkerAndOpsConstraints,
  workerConstraintsMapFromPayload,
  workersFromRows,
} from "./persist";
import type { Person, PersonConstraints, ShiftId } from "./types";

function worker(id: string, constraints?: PersonConstraints): Person {
  return {
    id,
    name: id,
    preferred: "heating",
    shift: "0800-1800" as ShiftId,
    group: "floor",
    present: true,
    constraints,
  };
}

/** PUT 후 workers.constraints + ops.workerConstraints에 같은 스냅샷이 저장되고 GET에서 merge되는 경로 */
function roundTripGet(
  workerConstraints: PersonConstraints | undefined,
  opsConstraints: PersonConstraints | Record<string, never>
): PersonConstraints | undefined {
  const rows = workersFromRows([
    {
      worker_id: "w1",
      name: "w1",
      preferred: "heating",
      shift: "0800-1800",
      worker_group: "floor",
      sort_order: 0,
      constraints: workerConstraints ?? {},
    },
  ]);
  const opsMap = workerConstraintsMapFromPayload({
    workerConstraints: { w1: opsConstraints },
  });
  return applyWorkerConstraintsMap(rows, opsMap)[0]?.constraints;
}

describe("constraints 저장→조회 round-trip", () => {
  it("테스트 1: excluded 저장 후 조회하면 true다", () => {
    const saved = constraintsForPut({ excluded: true }, {}, {});
    expect(saved.excluded).toBe(true);
    const got = roundTripGet(saved, saved);
    expect(got?.excluded).toBe(true);
  });

  it("테스트 2: 숙련·자격·현장백업만 바꿔 저장해도 excluded와 stayFloor가 유지된다", () => {
    const live = { excluded: true, stayFloor: true };
    const incoming: PersonConstraints = {
      excluded: true,
      stayFloor: true,
      fieldBackup: true,
      qualificationsByGroup: { phono_signature: { threeSidePacker: true } },
      skillConfiguredGroups: ["phono_signature"],
    };
    const saved = constraintsForPut(incoming, live, {});
    expect(saved.excluded).toBe(true);
    expect(saved.stayFloor).toBe(true);
    expect(saved.fieldBackup).toBe(true);
    const afterSkillOnly = constraintsForPut({ skillConfiguredGroups: ["phono_basil_corn"] }, saved, saved);
    expect(afterSkillOnly.excluded).toBe(true);
    expect(afterSkillOnly.stayFloor).toBe(true);
    expect(afterSkillOnly.skillConfiguredGroups).toEqual(
      expect.arrayContaining(["phono_signature", "phono_basil_corn"])
    );
    const got = roundTripGet(afterSkillOnly, { fieldBackup: true });
    expect(got?.excluded).toBe(true);
    expect(got?.stayFloor).toBe(true);
  });

  it("테스트 3: ops 빈 객체가 workers.constraints의 excluded를 지우지 않는다", () => {
    const got = roundTripGet({ excluded: true, stayFloor: true }, {});
    expect(got).toEqual(expect.objectContaining({ excluded: true, stayFloor: true }));
    const merged = mergeWorkerAndOpsConstraints({ excluded: true, stayFloor: true }, {});
    expect(merged.excluded).toBe(true);
    expect(merged.stayFloor).toBe(true);
  });

  it("테스트 4: ops 일부 필드는 기존 excluded·자격을 유지한 채 합친다", () => {
    const got = roundTripGet(
      { qualificationsByGroup: { phono_signature: { threeSidePacker: true } } },
      { fieldBackup: true }
    );
    expect(got?.excluded).toBeUndefined();
    expect(got?.fieldBackup).toBe(true);
    expect(got?.qualificationsByGroup?.phono_signature?.threeSidePacker).toBe(true);
  });

  it("테스트 4b: 구형 flat qualifications 조회 시 포노 제품군으로 이전된다", () => {
    const got = roundTripGet({ qualifications: { threeSidePacker: true } } as PersonConstraints, {});
    expect(got?.qualificationsByGroup?.phono_signature?.threeSidePacker).toBe(true);
    expect(got?.qualificationsByGroup?.parbake?.threeSidePacker).toBeUndefined();
  });

  it("테스트 5: 제품군별 qualification은 ops가 기존 키를 삭제하지 않는다", () => {
    const got = mergeWorkerAndOpsConstraints(
      { qualificationsByGroup: { phono_signature: { threeSidePacker: true } } },
      { qualificationsByGroup: { phono_signature: { extraMachine: true } } }
    );
    expect(got.qualificationsByGroup?.phono_signature?.threeSidePacker).toBe(true);
    expect(got.qualificationsByGroup?.phono_signature?.extraMachine).toBe(true);
  });

  it("PUT incoming이 부분 객체여도 live excluded를 덮어쓰지 않는다", () => {
    const saved = constraintsForPut({ skillConfiguredGroups: ["phono_signature"] }, { excluded: true, doughCore: false }, {});
    expect(saved.excluded).toBe(true);
    expect(saved.doughCore).toBe(false);
    expect(saved.skillConfiguredGroups).toContain("phono_signature");
    expect(constraintsForSave({ fieldBackup: true }, { excluded: true }).excluded).toBe(true);
  });

  it("workersFromRows + 빈 ops 맵 조회에서도 워커 JSONB excluded가 남는다", () => {
    const people = applyWorkerConstraintsMap(
      [worker("w1", { excluded: true, stayFloor: true })],
      { w1: {} }
    );
    expect(people[0].constraints?.excluded).toBe(true);
    expect(people[0].constraints?.stayFloor).toBe(true);
  });
});
