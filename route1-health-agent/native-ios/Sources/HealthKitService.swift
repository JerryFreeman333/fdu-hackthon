import Foundation
import HealthKit
import UIKit

@MainActor
final class HealthKitService: ObservableObject {
    typealias AutomaticUpload = @MainActor ([HealthMeasurement], Date?, String) async -> Bool

    @Published var authorizationStatus = "not-requested"
    @Published var measurements: [HealthMeasurement] = []
    @Published var lastReadAt: Date?
    @Published var message = "尚未请求 Apple 健康权限"
    @Published var isWorking = false
    @Published var automaticSyncStatus = "正在启动"
    @Published var lastAutomaticSyncAt: Date?

    private let store = HKHealthStore()
    private let calendar = Calendar.current
    private let debounceNanoseconds: UInt64 = 5_000_000_000
    private var observerQueries: [HKObserverQuery] = []
    private var debounceTask: Task<Void, Never>?
    private var automaticUpload: AutomaticUpload?
    private var automaticSyncInFlight = false
    private var automaticSyncPending = false

    private var readTypes: Set<HKObjectType> {
        var types = Set<HKObjectType>()
        let quantityIdentifiers: [HKQuantityTypeIdentifier] = [
            .stepCount,
            .restingHeartRate,
            .walkingSpeed,
            .oxygenSaturation
        ]
        quantityIdentifiers.forEach { identifier in
            if let type = HKObjectType.quantityType(forIdentifier: identifier) { types.insert(type) }
        }
        if let sleep = HKObjectType.categoryType(forIdentifier: .sleepAnalysis) { types.insert(sleep) }
        return types
    }

    private var observedTypes: [HKSampleType] {
        readTypes.compactMap { $0 as? HKSampleType }
    }

    func startAutomaticSync(upload: @escaping AutomaticUpload) async {
        automaticUpload = upload
        registerObserversIfNeeded()
        await enableBackgroundDelivery()
        await performAutomaticSync(reason: "App 启动")
    }

    func requestAuthorization() async {
        guard HKHealthStore.isHealthDataAvailable() else {
            message = BridgeError.healthUnavailable.localizedDescription
            return
        }
        isWorking = true
        defer { isWorking = false }
        do {
            try await store.requestAuthorization(toShare: [], read: readTypes)
            authorizationStatus = "request-completed"
            message = "权限请求已完成。Apple 为保护隐私，不会告知某一种读取权限是否被拒绝；请通过同步结果核对。"
            registerObserversIfNeeded()
            await enableBackgroundDelivery()
            scheduleAutomaticSync(reason: "权限完成", delayNanoseconds: 0)
        } catch {
            authorizationStatus = "not-requested"
            message = "权限请求失败：\(error.localizedDescription)"
        }
    }

    func readLast22Days() async {
        guard HKHealthStore.isHealthDataAvailable() else {
            message = BridgeError.healthUnavailable.localizedDescription
            return
        }
        guard !isWorking else {
            message = "已有读取或上传正在进行，请稍候。"
            return
        }
        isWorking = true
        defer { isWorking = false }
        do {
            try await refreshMeasurements()
        } catch {
            message = "读取失败：\(error.localizedDescription)"
        }
    }

    private func registerObserversIfNeeded() {
        guard observerQueries.isEmpty, HKHealthStore.isHealthDataAvailable() else { return }
        for type in observedTypes {
            let query = HKObserverQuery(sampleType: type, predicate: nil) { [weak self] _, completionHandler, error in
                Task { [weak self] in
                    await self?.handleObserverCallback(error: error)
                    completionHandler()
                }
            }
            observerQueries.append(query)
            store.execute(query)
        }
        automaticSyncStatus = "监听中（变化后 5 秒同步）"
    }

    private func handleObserverCallback(error: Error?) {
        if let error {
            automaticSyncStatus = "监听错误：\(error.localizedDescription)"
            return
        }
        scheduleAutomaticSync(reason: "HealthKit 变化", delayNanoseconds: debounceNanoseconds)
    }

    private func enableBackgroundDelivery() async {
        guard HKHealthStore.isHealthDataAvailable() else { return }
        var failures = 0
        for type in observedTypes {
            do {
                // .immediate 是请求频率而不是时限承诺；后台唤醒的实际时机始终由 iOS 调度。
                try await store.enableBackgroundDelivery(for: type, frequency: .immediate)
            } catch {
                failures += 1
            }
        }
        if failures > 0 {
            automaticSyncStatus = "前台监听中；部分后台投递未启用"
        }
    }

    private func scheduleAutomaticSync(reason: String, delayNanoseconds: UInt64) {
        debounceTask?.cancel()
        automaticSyncStatus = delayNanoseconds == 0 ? "准备自动同步" : "检测到变化，5 秒后同步"
        debounceTask = Task { [weak self] in
            if delayNanoseconds > 0 {
                try? await Task.sleep(nanoseconds: delayNanoseconds)
            }
            guard !Task.isCancelled else { return }
            await self?.performAutomaticSync(reason: reason)
        }
    }

    private func performAutomaticSync(reason: String) async {
        guard let automaticUpload else {
            automaticSyncStatus = "等待上传器配置"
            return
        }
        if automaticSyncInFlight || isWorking {
            automaticSyncPending = true
            automaticSyncStatus = "同步进行中；新变化已合并"
            return
        }

        automaticSyncInFlight = true
        isWorking = true
        automaticSyncStatus = "\(reason)：读取中"
        defer {
            automaticSyncInFlight = false
            isWorking = false
            if automaticSyncPending {
                automaticSyncPending = false
                scheduleAutomaticSync(reason: "合并的 HealthKit 变化", delayNanoseconds: 0)
            }
        }

        do {
            try await refreshMeasurements()
            guard !measurements.isEmpty else {
                automaticSyncStatus = "未读到真实样本，不上传"
                return
            }
            automaticSyncStatus = "\(reason)：上传中"
            let uploaded = await automaticUpload(measurements, lastReadAt, authorizationStatus)
            if uploaded {
                lastAutomaticSyncAt = Date()
                automaticSyncStatus = "自动同步成功"
            } else {
                automaticSyncStatus = "自动上传失败；等待下次变化或手动重试"
            }
        } catch {
            message = "自动读取失败：\(error.localizedDescription)"
            automaticSyncStatus = "自动读取失败"
        }
    }

    private func refreshMeasurements() async throws {
        measurements = []
        lastReadAt = nil
        let start = calendar.date(byAdding: .day, value: -21, to: calendar.startOfDay(for: Date()))!
        async let steps = queryDailySteps(from: start, to: Date())
        async let heart = queryQuantity(.restingHeartRate, metric: "restingHr", unit: HKUnit.count().unitDivided(by: .minute()), outputUnit: "bpm", multiplier: 1, from: start)
        async let speed = queryQuantity(.walkingSpeed, metric: "walkSpeed", unit: HKUnit.meter().unitDivided(by: .second()), outputUnit: "m/s", multiplier: 1, from: start)
        async let oxygen = queryQuantity(.oxygenSaturation, metric: "spo2", unit: .percent(), outputUnit: "%", multiplier: 100, from: start)
        async let sleep = querySleep(from: start)
        let (stepItems, heartItems, speedItems, oxygenItems, sleepItems) = try await (steps, heart, speed, oxygen, sleep)
        measurements = (stepItems + heartItems + speedItems + oxygenItems + sleepItems).sorted { $0.timestamp < $1.timestamp }
        lastReadAt = Date()
        if measurements.isEmpty {
            authorizationStatus = "limited-or-no-data"
            message = "没有读到样本：可能是权限未开放、只开放了有限历史，或 Apple 健康中尚无这些数据。不会生成 Demo 数据。"
        } else {
            authorizationStatus = "request-completed"
            message = "已读取 \(measurements.count) 条真实 HealthKit 记录。"
        }
    }

    private func predicate(from start: Date, to end: Date = Date()) -> NSPredicate {
        HKQuery.predicateForSamples(withStart: start, end: end, options: .strictStartDate)
    }

    private func queryDailySteps(from start: Date, to end: Date) async throws -> [HealthMeasurement] {
        guard let type = HKQuantityType.quantityType(forIdentifier: .stepCount) else { return [] }
        let anchor = calendar.startOfDay(for: start)
        let queryPredicate = predicate(from: start, to: end)
        let collection: HKStatisticsCollection = try await withCheckedThrowingContinuation { continuation in
            let query = HKStatisticsCollectionQuery(quantityType: type, quantitySamplePredicate: queryPredicate, options: .cumulativeSum, anchorDate: anchor, intervalComponents: DateComponents(day: 1))
            query.initialResultsHandler = { _, result, error in
                if let error { continuation.resume(throwing: error) }
                else if let result { continuation.resume(returning: result) }
                else { continuation.resume(throwing: BridgeError.emptyResponse) }
            }
            store.execute(query)
        }
        var output: [HealthMeasurement] = []
        collection.enumerateStatistics(from: start, to: end) { statistics, _ in
            guard let quantity = statistics.sumQuantity() else { return }
            let value = quantity.doubleValue(for: .count())
            guard value > 0 else { return }
            output.append(self.makeAggregate(metric: "steps", value: value, unit: "步", date: statistics.startDate, aggregation: "HealthKit daily cumulativeSum"))
        }
        return output
    }

    private func queryQuantity(_ identifier: HKQuantityTypeIdentifier, metric: String, unit: HKUnit, outputUnit: String, multiplier: Double, from start: Date) async throws -> [HealthMeasurement] {
        guard let type = HKQuantityType.quantityType(forIdentifier: identifier) else { return [] }
        let samples: [HKQuantitySample] = try await withCheckedThrowingContinuation { continuation in
            let sort = NSSortDescriptor(key: HKSampleSortIdentifierEndDate, ascending: true)
            let query = HKSampleQuery(sampleType: type, predicate: predicate(from: start), limit: HKObjectQueryNoLimit, sortDescriptors: [sort]) { _, samples, error in
                if let error { continuation.resume(throwing: error) }
                else { continuation.resume(returning: (samples as? [HKQuantitySample]) ?? []) }
            }
            store.execute(query)
        }
        return samples.map { sample in
            let source = sample.sourceRevision.source
            let device = sample.device
            return HealthMeasurement(
                id: "healthkit-\(sample.uuid.uuidString)", timestamp: ISO8601DateFormatter.bridge.string(from: sample.endDate),
                metric: metric, value: sample.quantity.doubleValue(for: unit) * multiplier, unit: outputUnit,
                source: "healthkit", confidence: 1, visibility: "private",
                metadata: ["sourceName": source.name, "sourceBundleId": source.bundleIdentifier,
                           "deviceName": device?.name ?? "", "deviceModel": device?.model ?? "",
                           "healthkitUuid": sample.uuid.uuidString]
            )
        }
    }

    private func querySleep(from start: Date) async throws -> [HealthMeasurement] {
        guard let type = HKCategoryType.categoryType(forIdentifier: .sleepAnalysis) else { return [] }
        let samples: [HKCategorySample] = try await withCheckedThrowingContinuation { continuation in
            let query = HKSampleQuery(sampleType: type, predicate: predicate(from: start), limit: HKObjectQueryNoLimit, sortDescriptors: nil) { _, samples, error in
                if let error { continuation.resume(throwing: error) }
                else { continuation.resume(returning: (samples as? [HKCategorySample]) ?? []) }
            }
            store.execute(query)
        }
        let asleepValues: Set<Int> = [
            HKCategoryValueSleepAnalysis.asleepUnspecified.rawValue,
            HKCategoryValueSleepAnalysis.asleepCore.rawValue,
            HKCategoryValueSleepAnalysis.asleepDeep.rawValue,
            HKCategoryValueSleepAnalysis.asleepREM.rawValue
        ]
        let asleep = samples.filter { asleepValues.contains($0.value) }
        let grouped = Dictionary(grouping: asleep) { calendar.startOfDay(for: $0.endDate) }
        return grouped.compactMap { date, daySamples in
            let hours = daySamples.reduce(0.0) { $0 + $1.endDate.timeIntervalSince($1.startDate) } / 3600
            return hours > 0 ? makeAggregate(metric: "sleepHours", value: hours, unit: "小时", date: date, aggregation: "HealthKit sleep-stage duration sum") : nil
        }
    }

    private func makeAggregate(metric: String, value: Double, unit: String, date: Date, aggregation: String) -> HealthMeasurement {
        let localNoon = calendar.date(bySettingHour: 12, minute: 0, second: 0, of: date) ?? date
        let timestamp = ISO8601DateFormatter.bridge.string(from: localNoon)
        return HealthMeasurement(id: "healthkit-aggregate-\(metric)-\(timestamp)", timestamp: timestamp, metric: metric,
                                 value: value, unit: unit, source: "healthkit", confidence: 1, visibility: "private",
                                 metadata: ["sourceName": "Apple Health aggregate", "deviceName": UIDevice.current.name, "aggregation": aggregation])
    }
}
