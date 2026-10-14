using Microsoft.AspNetCore.Mvc;

namespace temperature_humi.Controllers
{
    public class SeoHomeController : Controller
    {
        public IActionResult Index()
        {
            return View();
        }
    }
}
