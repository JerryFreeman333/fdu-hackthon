import Foundation
import HealthKit
import UIKit

@MainActor
final class HealthKitService: ObservableObject {
    @Published var authorizationStatus = "not-requested"
    @Published var measurements: [HealthMeasurement] = []
    @Published var message = "尚未请求 Apple 健康权限"
    @Published var isWorking = false

    private let store = HKHealthStore()
    private let calendar = Calendar.current

    private var readTypes: Set<HKObjectType> {
        var types = Set<HKObjectType>()
        [.stepCount, .restingHeartRate, .walkingSpeed, .oxygenSaturation].forEach {
            if let type = HKObjectType.quantityType(forIdentifier: $0) { types.insert(type) }
        }
        if let sleep = HKObjectType.categoryType(forIdentifier: .sleepAnalysis) { types.insert(sleep) }
        return types
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
        isWorking = true
        defer { isWorking = false }
        do {
            let start = calendar.date(byAdding: .day, value: -21, to: calendar.startOfDay(for: Date()))!
            async let steps = queryDailySteps(from: start, to: Date())
            async let heart = queryQuantity(.restingHeartRate, metric: "restingHr", unit: HKUnit.count().unitDivided(by: .minute()), outputUnit: "bpm", multiplier: 1, from: start)
            async let speed = queryQuantity(.walkingSpeed, metric: "walkSpeed", unit: HKUnit.meter().unitDivided(by: .second()), outputUnit: "m/s", multiplier: 1, from: start)
            async let oxygen = queryQuantity(.oxygenSaturation, metric: "spo2", unit: .percent(), outputUnit: "%", multiplier: 100, from: start)
            async let sleep = querySleep(from: start)
            let (stepItems, heartItems, speedItems, oxygenItems, sleepItems) = try await (steps, heart, speed, oxygen, sleep)
            measurements = (stepItems + heartItems + speedItems + oxygenItems + sleepItems).sorted { $0.timestamp < $1.timestamp }
            if measurements.isEmpty {
                authorizationStatus = "limited-or-no-data"
                message = "没有读到样本：可能是权限未开放、只开放了有限历史，或 Apple 健康中尚无这些数据。不会生成 Demo 数据。"
            } else {
                authorizationStatus = "request-completed"
                message = "已读取 \(measurements.count) 条真实 HealthKit 记录。"
            }
        } catch {
            message = "读取失败：\(error.localizedDescription)"
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
        let asleepValues: Set<Int> = [HKCategoryValueSleepAnalysis.asleepUnspecified.rawValue, .asleepCore.rawValue, .asleepDeep.rawValue, .asleepREM.rawValue]
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
