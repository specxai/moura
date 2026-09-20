import { canonicalCaseIdError } from "../id.js";

/**
 * Adds Allure Metadata API labels only for the dedicated Allure run. The Allure
 * reporter removes these suffixes from its result title, while normal Vitest
 * output retains the readable name alone.
 */
export function mouraEvidenceName(
  name: string,
  cases: readonly string[],
  layer: string,
): string {
  if (process.env.MOURA_ALLURE_METADATA !== "true" || cases.length === 0)
    return name;

  const hierarchies = cases.map((caseId) => {
    if (canonicalCaseIdError(caseId))
      throw new Error(`Invalid canonical Moura Case ID: ${caseId}`);
    const parts = caseId.split("/");
    const [requirement, scenario, testCase] = parts as [string, string, string];
    return { requirement, scenario, testCase };
  });
  const mouraLabels = hierarchies.flatMap(
    ({ requirement, scenario, testCase }) => [
      `@allure.label.moura_requirement:${requirement}`,
      `@allure.label.moura_scenario:${scenario}`,
      `@allure.label.moura_case:${testCase}`,
    ],
  );
  const representative = hierarchies[0]!;
  const behaviorLabels = [
    `@allure.label.epic:${representative.requirement}`,
    `@allure.label.feature:${representative.scenario}`,
    `@allure.label.story:${representative.testCase}`,
  ];
  return [
    name,
    ...mouraLabels,
    `@allure.label.moura_layer:${layer}`,
    ...behaviorLabels,
  ].join(" ");
}

/**
 * Applies a reviewed default Evidence mapping to every otherwise-unmapped test
 * declared through a Vitest Test API. Explicit `mouraEvidenceName()` mappings
 * take precedence, which lets focused tests cover a more specific Case (or
 * multiple Cases) than the suite default.
 *
 * The proxy also follows APIs returned by modifiers such as `each`, so the
 * repository cannot accidentally omit parameterized tests from its dedicated
 * dogfooding run.
 */
export function mouraEvidenceTest<T extends object>(
  testApi: T,
  cases: readonly string[],
  layer: string,
): T {
  const wrap = (value: unknown): unknown => {
    if (typeof value !== "function") return value;
    return new Proxy(value, {
      apply(target, thisArgument, argumentsList) {
        const args = [...argumentsList];
        if (
          typeof args[0] === "string" &&
          !args[0].includes("@allure.label.moura_case:")
        )
          args[0] = mouraEvidenceName(args[0], cases, layer);
        return wrap(Reflect.apply(target, thisArgument, args));
      },
      get(target, property, receiver) {
        return wrap(Reflect.get(target, property, receiver));
      },
    });
  };

  return wrap(testApi) as T;
}
