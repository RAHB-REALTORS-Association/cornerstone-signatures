export const DEFAULT_TEMPLATE = `<table cellpadding="0" cellspacing="0" border="0" style="font-family:Arial,sans-serif;color:#172554;font-size:12pt;line-height:1.3;border-collapse:collapse">
  <tr><td>
    <strong style="font-size:14pt">{{displayName}}</strong><br>
    <em style="font-size:11pt">{{title}}</em><br>
    <span style="font-size:10pt">{{designations}}</span><br><br>
    <strong>{{organizationName}}</strong><br>
    {{locations}}<br>
    {{phone}}<br>
    <a href="mailto:{{email}}" style="color:#172554">{{email}}</a><br>
    <a href="{{websiteUrl}}" style="color:#172554">{{websiteUrl}}</a><br><br>
    <span style="font-size:10pt">{{tagline}}</span>
  </td></tr>
</table>`;
