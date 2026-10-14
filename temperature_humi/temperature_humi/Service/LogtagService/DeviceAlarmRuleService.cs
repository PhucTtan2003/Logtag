using System.Collections.Concurrent;
using temperature_humi.Models;

namespace temperature_humi.Service.LogtagService
{
    /// <summary>Cache: serial -> AlarmRule. Cập nhật bởi ProfilesPollingStream.</summary>
    public sealed class DeviceAlarmRuleService
    {
        private readonly ConcurrentDictionary<string, AlarmRule> _bySerial =
            new(StringComparer.OrdinalIgnoreCase);

        private static string Norm(string s) => (s ?? "").Trim().ToUpperInvariant();

        public void SetMany(Dictionary<string, AlarmRule> map)
        {
            if (map == null) return;
            foreach (var kv in map) _bySerial[Norm(kv.Key)] = kv.Value;
        }

        public bool TryGet(string serialNumber, out AlarmRule? rule)
            => _bySerial.TryGetValue(Norm(serialNumber), out rule);

        public AlarmRule? GetOrDefault(string serialNumber)
            => _bySerial.TryGetValue(Norm(serialNumber), out var r) ? r : null;

        public IReadOnlyDictionary<string, AlarmRule> Snapshot() => _bySerial;
    }
}
