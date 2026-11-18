using System.Net.Http;
using System.Net.Http.Json;
using System.Text.Json;

namespace RemoteControl.Agent;

public partial class MainWindow : System.Windows.Window
{
    private readonly ConsentSessionManager _sessions = new();
    private readonly PairingClient _pairingClient = new("http://localhost:8787");

    public MainWindow()
    {
        InitializeComponent();
        _sessions.StateChanged += (_, state) => Dispatcher.Invoke(() => StatusText.Text = $"Status: {state}");
    }

    private async void CreatePairing_Click(object sender, System.Windows.RoutedEventArgs e)
    {
        try
        {
            StatusText.Text = "Status: creating pairing";
            var pairing = await _pairingClient.CreateAsync("Windows PC");
            PairingIdText.Text = pairing.PairingId;
            PairingSecretText.Text = pairing.Secret;
            ExpiryText.Text = $"Expires: {pairing.ExpiresAt.ToLocalTime():G}";
            StatusText.Text = "Status: waiting for phone";
        }
        catch (HttpRequestException)
        {
            StatusText.Text = "Status: signaling server unavailable";
        }
        catch (JsonException)
        {
            StatusText.Text = "Status: invalid signaling response";
        }
    }

    private void Disconnect_Click(object sender, System.Windows.RoutedEventArgs e) => _sessions.Disconnect();
}

public sealed record PairingResponse(string PairingId, string Secret, DateTimeOffset ExpiresAt);

public sealed class PairingClient
{
    private readonly HttpClient _httpClient;
    private readonly string _baseUrl;

    public PairingClient(string baseUrl)
    {
        _baseUrl = baseUrl.TrimEnd('/');
        _httpClient = new HttpClient { Timeout = TimeSpan.FromSeconds(10) };
    }

    public async Task<PairingResponse> CreateAsync(string deviceName)
    {
        var deviceId = $"windows-{Guid.NewGuid():N}";
        using var response = await _httpClient.PostAsJsonAsync(
            $"{_baseUrl}/pairing/create",
            new { deviceId, deviceName });
        response.EnsureSuccessStatusCode();
        return await response.Content.ReadFromJsonAsync<PairingResponse>()
            ?? throw new JsonException("Pairing response was empty.");
    }
}

public sealed class ConsentSessionManager
{
    public event EventHandler<string>? StateChanged;
    public void Disconnect() => StateChanged?.Invoke(this, "disconnected");
    public bool CanInjectInput(bool paired, bool enabled, bool consented) => paired && enabled && consented;
}
