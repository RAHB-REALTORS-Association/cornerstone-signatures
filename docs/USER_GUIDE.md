# Administrator and user guide

## How delivery works

Directory staff data, template design, and publishing are separate. Outlook sends the current From address to the service, which checks eligibility and chooses the highest-priority matching active deployment. Personal values, organization settings, location mappings, taglines, and custom tags are merged only when the signature is requested.

Draft changes never affect users until published. A publication stores an immutable template snapshot. A limited-audience signature with a higher integer priority overrides the all-staff default; unpublishing it makes members fall back to their next match.

## IT administration

- **Staff & access:** edit applicability, picker visibility, title/location/phone overrides, roles, self-service permissions, and shared-mailbox identity. Bulk actions retain selections. Block adds an exact address to the Entra exclusions and removes the local record.
- **Audiences:** create reusable groups for limited deployments. Audiences with no active deployment may be deleted while historical audit references remain.
- **Deployments:** inspect, reprioritize, schedule, cancel, or unpublish deployments. Unpublishing the default leaves unmatched users without an automated signature.
- **Audit log:** search activity and export it for review.
- **Manage:** set organization name and URLs, map Entra office locations to exact output strings, configure sync filters/schedules/defaults, and export or import the database.

Entra synchronization refreshes directory fields and photos while preserving local overrides, roles, visibility, applicability, preferences, and audience membership. Deleting an eligible person is temporary; a later sync recreates them. Blocking prevents that.

For shared mailboxes, **Signed-in employee** uses the sender's eligibility but renders the authenticated employee's personal details. **This account / mailbox** renders the mailbox record itself. Aliases and Microsoft 365 Groups are not equivalent to Exchange shared mailboxes and should be tested.

## Communications administration

- **Signature templates:** create visual MJML or direct HTML templates, duplicate them, preview per user, save drafts, publish now, or schedule a publication.
- **Audiences:** maintain membership and select an audience while publishing.
- **Tags:** manage safe plain-text custom merge values.
- **Taglines editor:** manage the approved phrases available to templates and permitted users.

The first template is protected from deletion. Other templates can be deleted only when they have no active deployment or pending schedule.

Built-in merge tags include:

```text
{{displayName}} {{firstName}} {{lastName}} {{title}}
{{phone}} {{email}} {{officeLocation}} {{locations}} {{tagline}}
{{organizationName}} {{websiteUrl}} {{facebookUrl}} {{instagramUrl}}
{{linkedinUrl}} {{xUrl}} {{threadsUrl}} {{blueskyUrl}} {{youtubeUrl}}
```

Custom tags are plain text, cannot replace built-ins, and update dynamically without republishing. Directory and custom values are HTML-escaped. MJML is compiled on the server; filesystem-backed `<mj-include>` is rejected.

## Staff use

In supported Outlook clients, opening a new compose automatically inserts the assigned signature. Changing From reevaluates it. The task-pane button previews the assignment and **Refresh signature** reapplies it to the current draft.

The root page is for preview and manual copying when an email client is unsupported. When IT enables the individual permissions, a user can also pause automatic delivery and/or choose an approved tagline there.

If a signature does not appear, confirm the From address is a managed applicable record with a matching published deployment, remove any old Outlook automatic signature, restart the client, and inspect server Outlook diagnostics. Classic Outlook can remain in the Windows notification area after its window closes.
