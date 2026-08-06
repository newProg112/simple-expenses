const safeCount = value => {
  const count = Number(value);
  return Number.isInteger(count) && count >= 0 ? count : 0;
};

const safePercent = value => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(100, number)) : 0;
};

const safeNumber = value => {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
};

const safeNullableNumber = value => value === null ? null : safeNumber(value);

const safeText = (value, maximum = 100) => typeof value === "string"
  ? value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, maximum)
  : "";

const safeIsoDate = value => {
  if(typeof value !== "string") return "";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : "";
};

export function normalizeCustomerAnalyticsPayload(payload){
  const source = payload && typeof payload === "object" ? payload : {};
  const summary = source.summary && typeof source.summary === "object" ? source.summary : {};
  const plan = source.planAdoption && typeof source.planAdoption === "object" ? source.planAdoption : {};
  const normalizePlanItem = (item, allowNull = false) => ({
    count: safeCount(item?.count),
    percentageOfKnown: allowNull && item?.percentageOfKnown === null ? null : safePercent(item?.percentageOfKnown)
  });
  const normalizeAction = item => ({
    key: safeText(item?.key, 50),
    label: safeText(item?.label, 80),
    count: safeCount(item?.count),
    share: safePercent(item?.share)
  });
  const normalizeBusinessCustomer = item => ({
    businessName: safeText(item?.businessName, 160),
    email: safeText(item?.email, 254),
    plan: ["starter", "pro", "unknown"].includes(item?.plan) ? item.plan : "unknown",
    subscriptionStatus: safeText(item?.subscriptionStatus, 30),
    lastActive: item?.lastActive === null ? null : safeIsoDate(item?.lastActive),
    daysInactive: safeNullableNumber(item?.daysInactive),
    safeEvents: safeCount(item?.safeEvents),
    activeDays: safeCount(item?.activeDays),
    averageEventsPerActiveDay: safeNumber(item?.averageEventsPerActiveDay),
    aiAssistantSuccessfulUses: safeCount(item?.aiAssistantSuccessfulUses),
    invoiceScanningSuccessfulUses: safeCount(item?.invoiceScanningSuccessfulUses)
  });
  const business = source.businessIntelligence && typeof source.businessIntelligence === "object"
    ? source.businessIntelligence : {};
  const businessKpis = business.kpis && typeof business.kpis === "object" ? business.kpis : {};
  return {
    schemaVersion: safeCount(source.schemaVersion),
    range: ["7d", "30d", "all"].includes(source.range) ? source.range : "30d",
    generatedAt: safeText(source.generatedAt, 40),
    summary: {
      activeCustomerAccounts: safeCount(summary.activeCustomerAccounts),
      newSignUps: safeCount(summary.newSignUps),
      activeStarterAccounts: safeCount(summary.activeStarterAccounts),
      activeProAccounts: safeCount(summary.activeProAccounts),
      activeUnknownPlanAccounts: safeCount(summary.activeUnknownPlanAccounts),
      starterToProConversionRate: safePercent(summary.starterToProConversionRate),
      totalTrackedCustomerActions: safeCount(summary.totalTrackedCustomerActions)
    },
    adoption: Array.isArray(source.adoption) ? source.adoption.map(normalizeAction).filter(item => item.key && item.label) : [],
    features: Array.isArray(source.features) ? source.features.map(normalizeAction).filter(item => item.key && item.label) : [],
    measuredFeatureActions: safeCount(source.measuredFeatureActions),
    daily: Array.isArray(source.daily) ? source.daily.map(item => ({
      date: /^\d{4}-\d{2}-\d{2}$/.test(item?.date) ? item.date : "",
      activeAccounts: safeCount(item?.activeAccounts),
      trackedActions: safeCount(item?.trackedActions)
    })).filter(item => item.date) : [],
    planAdoption: {
      starter: normalizePlanItem(plan.starter),
      pro: normalizePlanItem(plan.pro),
      unknown: normalizePlanItem(plan.unknown, true),
      knownAccounts: safeCount(plan.knownAccounts),
      conversionRate: safePercent(plan.conversionRate)
    },
    retention: {
      active24Hours: safeCount(source.retention?.active24Hours),
      active7Days: safeCount(source.retention?.active7Days),
      active30Days: safeCount(source.retention?.active30Days),
      dormant30Days: safeCount(source.retention?.dormant30Days)
    },
    signupCohorts: Array.isArray(source.signupCohorts) ? source.signupCohorts.map(item => ({
      monthKey: /^\d{4}-(0[1-9]|1[0-2])$/.test(item?.monthKey) ? item.monthKey : "",
      label: safeText(item?.label, 30),
      count: safeCount(item?.count)
    })).filter(item => item.monthKey && item.label).slice(-12) : [],
    returningUsers: {
      newUsersThisMonth: safeCount(source.returningUsers?.newUsersThisMonth),
      returningUsersThisMonth: safeCount(source.returningUsers?.returningUsersThisMonth),
      returningUserPercentage: safePercent(source.returningUsers?.returningUserPercentage)
    },
    featureAdoption: Array.isArray(source.featureAdoption) ? source.featureAdoption.map(item => ({
      key: safeText(item?.key, 50),
      label: safeText(item?.label, 80),
      customers: safeCount(item?.customers),
      percentageOfCustomers: safePercent(item?.percentageOfCustomers)
    })).filter(item => item.key && item.label).slice(0, 6) : [],
    conversionJourney: Array.isArray(source.conversionJourney) ? source.conversionJourney.map(item => ({
      key: safeText(item?.key, 50),
      label: safeText(item?.label, 80),
      count: safeCount(item?.count),
      percentageFromPrevious: safePercent(item?.percentageFromPrevious)
    })).filter(item => item.key && item.label).slice(0, 6) : [],
    topEngagedCustomers: Array.isArray(source.topEngagedCustomers) ? source.topEngagedCustomers.map(item => ({
      businessName: safeText(item?.businessName, 160),
      plan: ["starter", "pro", "unknown"].includes(item?.plan) ? item.plan : "unknown",
      lastActive: safeIsoDate(item?.lastActive),
      totalSafeActivityEvents: safeCount(item?.totalSafeActivityEvents),
      aiAssistantSuccessfulUses: safeCount(item?.aiAssistantSuccessfulUses),
      invoiceScanningSuccessfulUses: safeCount(item?.invoiceScanningSuccessfulUses)
    })).filter(item => item.lastActive).slice(0, 20) : [],
    businessIntelligence: {
      kpis: {
        starterNearAiLimit: safeCount(businessKpis.starterNearAiLimit),
        starterNearInvoiceScanningLimit: safeCount(businessKpis.starterNearInvoiceScanningLimit),
        starterNearActiveProjectLimit: safeNullableNumber(businessKpis.starterNearActiveProjectLimit),
        inactiveProAccounts: safeCount(businessKpis.inactiveProAccounts),
        customersInactive60Days: safeCount(businessKpis.customersInactive60Days),
        averageSafeEventsPerActiveCustomer: safeNumber(businessKpis.averageSafeEventsPerActiveCustomer)
      },
      availability: {activeProjectUsage: business.availability?.activeProjectUsage === true},
      upgradeCandidates: Array.isArray(business.upgradeCandidates) ? business.upgradeCandidates.map(item => ({
        ...normalizeBusinessCustomer(item),
        aiAllowanceUsage: safeNullableNumber(item?.aiAllowanceUsage),
        invoiceScanningAllowanceUsage: safeNullableNumber(item?.invoiceScanningAllowanceUsage),
        activeProjects: safeNullableNumber(item?.activeProjects),
        activeProjectAllowanceUsage: safeNullableNumber(item?.activeProjectAllowanceUsage),
        highestAllowanceUsage: safeNumber(item?.highestAllowanceUsage),
        suggestedReason: safeText(item?.suggestedReason, 100)
      })).slice(0, 20) : [],
      inactiveProAccounts: Array.isArray(business.inactiveProAccounts)
        ? business.inactiveProAccounts.map(normalizeBusinessCustomer).slice(0, 20) : [],
      recentlyActiveBusinesses: Array.isArray(business.recentlyActiveBusinesses)
        ? business.recentlyActiveBusinesses.map(normalizeBusinessCustomer).filter(item => item.lastActive).slice(0, 20) : [],
      engagementLeaders: Array.isArray(business.engagementLeaders)
        ? business.engagementLeaders.map(normalizeBusinessCustomer).filter(item => item.lastActive && item.safeEvents).slice(0, 20) : [],
      activeCustomerTrends: Array.isArray(business.activeCustomerTrends) ? business.activeCustomerTrends.map(item => ({
        date: /^\d{4}-\d{2}-\d{2}$/.test(item?.date) ? item.date : "",
        dau: safeCount(item?.dau),
        wau: safeCount(item?.wau),
        mau: safeCount(item?.mau)
      })).filter(item => item.date) : []
    },
    caps: {
      activityLimit: safeCount(source.caps?.activityLimit),
      accountLimit: safeCount(source.caps?.accountLimit),
      usageDocumentLimit: safeCount(source.caps?.usageDocumentLimit),
      usageDocumentsRead: safeCount(source.caps?.usageDocumentsRead),
      activityTruncated: source.caps?.activityTruncated === true,
      accountsTruncated: source.caps?.accountsTruncated === true,
      incomplete: source.caps?.incomplete === true
    },
    limitations: Array.isArray(source.limitations)
      ? source.limitations.map(value => safeText(value, 240)).filter(Boolean).slice(0, 10)
      : []
  };
}

export function customerAnalyticsErrorState(error){
  const code = String(error?.code || "").replace(/^functions\//, "");
  if(code === "unauthenticated") return {kind: "unauthenticated"};
  if(code === "permission-denied") return {kind: "permission-denied"};
  if(code === "failed-precondition"){
    return {kind: "error", title: "Customer Analytics is not configured", message: "The secure owner and demo-account configuration needs attention."};
  }
  return {kind: "error", title: "Customer Analytics could not be loaded", message: "Check your connection and try again."};
}

export function createCustomerAnalyticsLoader({request, onLoading = () => {}, onSuccess = () => {}, onError = () => {}}){
  const cache = new Map();
  let pending = null;
  return {
    load(range, {force = false} = {}){
      if(pending) return pending;
      if(!force && cache.has(range)){
        const value = cache.get(range);
        onSuccess(value, {cached: true});
        return Promise.resolve(value);
      }
      onLoading(range);
      pending = Promise.resolve().then(() => request(range)).then(value => {
        cache.set(range, value);
        onSuccess(value, {cached: false});
        return value;
      }).catch(error => {
        onError(error);
        return null;
      }).finally(() => { pending = null; });
      return pending;
    },
    clear(){ cache.clear(); }
  };
}
