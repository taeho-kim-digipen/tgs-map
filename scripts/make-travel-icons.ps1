Add-Type -AssemblyName System.Drawing
$iconDirectory = Join-Path $PSScriptRoot '../dist/icons'
[System.IO.Directory]::CreateDirectory($iconDirectory) | Out-Null
foreach ($size in @(180,192,512)) {
  $bitmap = [System.Drawing.Bitmap]::new($size,$size)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  $graphics.Clear([System.Drawing.ColorTranslator]::FromHtml('#122124'))
  $lime = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#d5f17b'))
  $dark = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#122124'))
  $white = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::White)
  $format = [System.Drawing.StringFormat]::new()
  $format.Alignment = [System.Drawing.StringAlignment]::Center
  $format.LineAlignment = [System.Drawing.StringAlignment]::Center
  $font = [System.Drawing.Font]::new([System.Drawing.FontFamily]::GenericSansSerif,[single]($size*.29),[System.Drawing.FontStyle]::Bold,[System.Drawing.GraphicsUnit]::Pixel)
  $smallFont = [System.Drawing.Font]::new([System.Drawing.FontFamily]::GenericSansSerif,[single]($size*.115),[System.Drawing.FontStyle]::Bold,[System.Drawing.GraphicsUnit]::Pixel)
  $tile = [System.Drawing.RectangleF]::new([single]($size*.12),[single]($size*.16),[single]($size*.76),[single]($size*.50))
  $graphics.FillRectangle($lime,$tile)
  $graphics.DrawString('TGS',$font,$dark,$tile,$format)
  $footer = [System.Drawing.RectangleF]::new(0,[single]($size*.70),$size,[single]($size*.17))
  $graphics.DrawString('2026',$smallFont,$white,$footer,$format)
  $fileName = if ($size -eq 180) {'apple-touch-icon.png'} else {"icon-$size.png"}
  $bitmap.Save((Join-Path $iconDirectory $fileName),[System.Drawing.Imaging.ImageFormat]::Png)
  $graphics.Dispose(); $bitmap.Dispose(); $lime.Dispose(); $dark.Dispose(); $white.Dispose(); $format.Dispose(); $font.Dispose(); $smallFont.Dispose()
}
