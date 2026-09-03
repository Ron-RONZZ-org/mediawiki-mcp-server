<?php

// Live-wiki E2E stack configuration, loaded by the WBS-generated
// LocalSettings.php (the image's template requires /config/Extensions.php
// when present).
//
// The Wikibase repo default allows NO sitelink groups (siteLinkGroups => []),
// so wbsetsitelink rejects every linksite. Allow the group the driver's
// addSite.php registration uses, mirroring the production instance's
// siteLinkGroups = [ 'ronzz' ] convention.

$wgWBRepoSettings['siteLinkGroups'] = [ 'ronzz' ];
