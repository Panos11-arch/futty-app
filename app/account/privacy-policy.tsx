import { DocBullet, DocEmailLink, DocHeading, DocParagraph, DocScreen } from '@/components/doc-screen';
import { CONTACT_EMAIL } from '@/lib/contact';
import { deviceLanguage } from '@/lib/language';

/** The Privacy policy, in English, or in Greek on a phone set to Greek
 *  (lib/language.ts). The same text is on the website: site/privacy/index.html
 *  (https://futty.app/privacy, which App Store Connect's Privacy Policy URL
 *  points at) and site/el/privacy/index.html (https://futty.app/el/privacy).
 *  tests/site/site-matches-app.test.tsx fails if they differ. */
export default function PrivacyPolicyScreen() {
  return deviceLanguage() === 'el' ? <PrivacyPolicyEl /> : <PrivacyPolicyEn />;
}

function PrivacyPolicyEn() {
  return (
    <DocScreen updated="November 2026">
      <DocParagraph>
        Futty (&quot;the app&quot;, &quot;we&quot;, &quot;us&quot;) is a pitch-booking and
        5-a-side-to-11-a-side football community app for Cyprus. This page explains what
        information the app collects, why, and how it&apos;s used.
      </DocParagraph>

      <DocHeading>Information you provide</DocHeading>
      <DocBullet>Email address: account sign-in and password recovery.</DocBullet>
      <DocBullet>Username, full name: identifies you to other players and teammates.</DocBullet>
      <DocBullet>
        Phone number (optional): only shown to other users if you turn on &quot;Show my number
        publicly&quot;, off by default.
      </DocBullet>
      <DocBullet>
        Date of birth: used only to check your age. It is never shown to anyone: only you and our
        server can read it. Once saved, it can only be changed by writing to us.
      </DocBullet>
      <DocBullet>
        City, gender, position, preferred foot, bio (optional): shown on your player profile so
        teammates and opponents know who they&apos;re playing with.
      </DocBullet>

      <DocHeading>Information created by using the app</DocHeading>
      <DocBullet>Bookings: which pitch, date and time you book or join.</DocBullet>
      <DocBullet>Teams and leagues: team membership, league standings and match results.</DocBullet>
      <DocBullet>
        Squad posts: &quot;need players&quot; and &quot;need opposition&quot; posts you create or
        respond to.
      </DocBullet>
      <DocBullet>
        Messages: chat messages sent between team captains to arrange a fixture, visible only to
        the two captains involved.
      </DocBullet>
      <DocBullet>Follows: which players or teams you choose to follow.</DocBullet>
      <DocBullet>
        Futty AI chats: your questions, any photos you attach and the answers (see &quot;Futty
        AI&quot; below).
      </DocBullet>
      <DocBullet>
        Location (optional): only when you tap &quot;Around me&quot;, rounded to about 1 km, to sort
        venues by distance on your phone. It is never sent to us or kept.
      </DocBullet>

      <DocHeading>Match records</DocHeading>
      <DocParagraph>When you play a match booked or arranged in Futty, we keep:</DocParagraph>
      <DocBullet>
        Check-ins: whether you checked in, when, and how (you scanned the venue&apos;s code, your
        captain ticked you, or the venue marked you as arrived). Only players who checked in count
        in stats, man of the match, ratings and levels.
      </DocBullet>
      <DocBullet>Goals, assists and lineups entered for the match.</DocBullet>
      <DocBullet>Man of the match votes and the ratings (1 to 10) you give other players.</DocBullet>
      <DocBullet>
        Your level and its history, worked out by Futty from results and ratings, and your answers
        to the level questions.
      </DocBullet>
      <DocBullet>
        Stats: season stats, leaderboards and team of the week, worked out from confirmed matches.
      </DocBullet>
      <DocParagraph>Who sees them:</DocParagraph>
      <DocBullet>
        Nobody sees who voted for whom or what score one player gave another. You see only your own
        vote and your own ratings.
      </DocBullet>
      <DocBullet>
        The match page (score, goals, lineups, each player&apos;s match rating once there are enough
        ratings, and the man of the match once voting closes) is seen by the players in the match,
        and by everyone signed in once the result is confirmed.
      </DocBullet>
      <DocBullet>Check-ins are seen by the players in the match and by the venue&apos;s staff.</DocBullet>
      <DocBullet>
        Levels, season stats, leaderboards and team of the week are seen by everyone signed in.
      </DocBullet>
      <DocBullet>Your answers to the level questions are seen only by you.</DocBullet>

      <DocHeading>What venues see</DocHeading>
      <DocParagraph>A venue&apos;s staff see, for their own venue only:</DocParagraph>
      <DocBullet>your bookings at that venue, and the players in them;</DocBullet>
      <DocBullet>what you paid at that venue and how;</DocBullet>
      <DocBullet>anything you owe that venue;</DocBullet>
      <DocBullet>
        whether you checked in, and how many times you held a spot and didn&apos;t show up.
      </DocBullet>
      <DocParagraph>
        A venue never sees your bookings, payments, debts or no-shows at another venue.
      </DocParagraph>
      <DocParagraph>
        When you open a venue&apos;s post-match offer, Futty makes a code for you. The venue sees
        what the code is for, how many codes were opened and which were used at its counter. These
        counts stay with the venue after you delete your account, but are no longer linked to you.
      </DocParagraph>

      <DocHeading>Players offered by a venue</DocHeading>
      <DocParagraph>
        A venue can offer a player who isn&apos;t on Futty to a team that&apos;s short. Staff type
        only that player&apos;s first name. There is no account, email or phone number, and Futty
        never contacts that player. The name is seen by the venue&apos;s staff, the booker, and, once
        the booker accepts, the other players in the booking.
      </DocParagraph>

      <DocHeading>Camera</DocHeading>
      <DocParagraph>
        If you allow it, Futty uses the camera only to scan the venue&apos;s check-in QR code at a
        match. The picture is read on your phone to find the code and is never saved or sent; only
        the code is sent to check you in. You can type the code instead.
      </DocParagraph>

      <DocHeading>Photos</DocHeading>
      <DocParagraph>
        Venue staff can choose photos from their phone to add pictures of their venue and its menu.
        Before the first upload, staff confirm the photos are the venue&apos;s and Futty may show
        them. Futty uploads only the photos staff pick, resized, and shows them to players in the
        app. Futty never reads players&apos; photo libraries.
      </DocParagraph>

      <DocHeading>Contacts</DocHeading>
      <DocParagraph>
        If you allow it, the Community tab reads the phone numbers in your device&apos;s contacts and
        checks them against Futty accounts so it can show which of your contacts already use the
        app. The numbers are sent to our server only for that check and are not stored.
      </DocParagraph>

      <DocHeading>Calendar</DocHeading>
      <DocParagraph>
        If you choose to add a booking to your calendar, Futty writes that event to your phone&apos;s
        calendar and remembers, on your phone only, which event it added. Futty doesn&apos;t read
        your other events or send them anywhere.
      </DocParagraph>

      <DocHeading>Notifications</DocHeading>
      <DocParagraph>
        If you enable push notifications, your device&apos;s push token is stored so we can tell you
        about your bookings, matches and squad posts. If you add your WhatsApp number and choose
        WhatsApp for reminders, we store that number and send those reminders through WhatsApp;
        reply STOP to stop them. You can turn each kind off at any time in Account &gt; Settings
        &gt; Notifications.
      </DocParagraph>

      <DocHeading>Biometric app lock</DocHeading>
      <DocParagraph>
        Face ID and fingerprint app lock is handled entirely on your device by iOS and
        Android&apos;s own biometric APIs. Futty never receives, stores or sends your biometric
        data; the app is only ever told &quot;unlocked&quot; or &quot;not unlocked&quot;.
      </DocParagraph>

      <DocHeading>Payments</DocHeading>
      <DocParagraph>
        Futty Premium (personal and team) is bought through Apple&apos;s App Store. Pitch bookings
        are paid by card through Stripe. In both cases the payment provider handles your card
        details; Futty never sees or stores your full card number. We keep a record of what you
        paid for, how much, and its status (held, charged, refunded).
      </DocParagraph>

      <DocHeading>Who your information is shared with</DocHeading>
      <DocBullet>
        Other users: your username, and any profile fields you&apos;ve chosen to make visible, are
        visible to other signed-in users (this is a community app; player and team browsing is a
        core feature). Your email and phone number (unless you opt in) are never shown to other
        users.
      </DocBullet>
      <DocBullet>Venues: as described in &quot;What venues see&quot;.</DocBullet>
      <DocBullet>
        Service providers: the app is built on Supabase (database, authentication, hosting),
        Expo/EAS (app infrastructure, push delivery), Stripe (card payments), Apple (App Store
        purchases), Sentry (crash and error reports, which include technical device information),
        Anthropic (processes Futty AI chat messages and photos to generate answers) and Meta (delivers WhatsApp
        reminders, if you choose them). These providers process data on our behalf.
      </DocBullet>
      <DocBullet>
        We do not sell your data, and we do not use third-party advertising or tracking SDKs.
      </DocBullet>

      <DocHeading>Blocking and reporting</DocHeading>
      <DocParagraph>
        You can block another user from within the app, which hides their messages and posts from
        you. You can also report a user or piece of content; reports are reviewed by the app&apos;s
        developer.
      </DocParagraph>

      <DocHeading>Age and young players</DocHeading>
      <DocBullet>You must be 14 or older to use Futty.</DocBullet>
      <DocBullet>
        Players under 18 (by today&apos;s date in Cyprus) show only their first name to other
        players and don&apos;t appear in adults&apos; player search.
      </DocBullet>
      <DocBullet>
        Adults and players under 18 can&apos;t send each other friend requests or private messages.
      </DocBullet>
      <DocBullet>
        In fixture chat, messages are turned off when either captain is under 18. Date proposals and
        scores still work.
      </DocBullet>
      <DocBullet>
        A report involving a player under 18 is marked urgent and sent to the founders straight away.
      </DocBullet>

      <DocHeading>Messages and friends</DocHeading>
      <DocBullet>
        Captains of two teams in the same league can message each other. Friends can message each
        other while they are friends.
      </DocBullet>
      <DocBullet>
        Messages are text only, up to 1,000 characters. They are stored on our servers so both sides
        can read the chat, and so we can review a report.
      </DocBullet>
      <DocBullet>
        The other side can see when a message reached your phone and when you read it.
      </DocBullet>
      <DocBullet>Blocking a player stops messages both ways.</DocBullet>
      <DocBullet>
        To stop spam, each player can send up to 30 messages a minute and 500 in any 24-hour period.
      </DocBullet>
      <DocBullet>
        If you delete your account, your messages stay in the other player&apos;s chat under
        &quot;Former player&quot;.
      </DocBullet>
      <DocBullet>
        A new message sends a notification, which you can turn off in Settings.
      </DocBullet>

      <DocHeading>Futty AI</DocHeading>
      <DocBullet>
        Your Futty AI chats and any photos you attach are stored on our servers so you can read them
        again. Only you can see them.
      </DocBullet>
      <DocBullet>
        Photos are made smaller on your phone, then sent only to Futty and to Anthropic, the AI
        provider that writes the answers.
      </DocBullet>
      <DocBullet>
        Chats and their photos are deleted automatically 7 days after the last message, and straight
        away if you delete your account.
      </DocBullet>

      <DocHeading>Your choices</DocHeading>
      <DocBullet>You can edit or remove most profile fields at any time from Edit Profile.</DocBullet>
      <DocBullet>You can turn off notifications and phone number visibility at any time.</DocBullet>
      <DocBullet>
        You can delete your account at any time from Account &gt; Settings &gt; Delete account. This
        removes your login, profile details and saved cards. Match results you took part in stay in
        league tables under &quot;Deleted player&quot; so other teams&apos; records stay accurate.
        You can also ask us to do this by email.
      </DocBullet>

      <DocHeading>Changes to this policy</DocHeading>
      <DocParagraph>
        If this policy changes materially, we&apos;ll update the &quot;Last updated&quot; date above.
      </DocParagraph>

      <DocHeading>Contact</DocHeading>
      <DocParagraph>Questions about this policy or your data:</DocParagraph>
      <DocEmailLink email={CONTACT_EMAIL} />
    </DocScreen>
  );
}

/** The Greek policy. Same sections, in the same order, as the English. */
function PrivacyPolicyEl() {
  return (
    <DocScreen updated="Νοέμβριος 2026" updatedLabel="Τελευταία ενημέρωση">
      <DocParagraph>
        Το Futty («η εφαρμογή», «εμείς») είναι εφαρμογή για κρατήσεις γηπέδων και κοινότητα
        ποδοσφαίρου, από 5x5 έως 11x11, στην Κύπρο. Αυτή η σελίδα εξηγεί ποιες πληροφορίες
        συλλέγει η εφαρμογή, γιατί και πώς χρησιμοποιούνται.
      </DocParagraph>

      <DocHeading>Πληροφορίες που μας δίνετε</DocHeading>
      <DocBullet>Διεύθυνση email: σύνδεση στον λογαριασμό και ανάκτηση κωδικού.</DocBullet>
      <DocBullet>
        Όνομα χρήστη, ονοματεπώνυμο: σας αναγνωρίζουν οι άλλοι παίκτες και οι συμπαίκτες σας.
      </DocBullet>
      <DocBullet>
        Αριθμός τηλεφώνου (προαιρετικά): εμφανίζεται σε άλλους χρήστες μόνο αν ενεργοποιήσετε το
        «Show my number publicly», που είναι απενεργοποιημένο από προεπιλογή.
      </DocBullet>
      <DocBullet>
        Ημερομηνία γέννησης: χρησιμοποιείται μόνο για τον έλεγχο της ηλικίας σας. Δεν εμφανίζεται
        ποτέ σε κανέναν: μόνο εσείς και ο διακομιστής μας μπορούμε να τη δούμε. Αφού αποθηκευτεί,
        αλλάζει μόνο αν μας γράψετε.
      </DocBullet>
      <DocBullet>
        Πόλη, φύλο, θέση, πόδι, βιογραφικό (προαιρετικά): εμφανίζονται στο προφίλ σας, ώστε
        συμπαίκτες και αντίπαλοι να ξέρουν με ποιον παίζουν.
      </DocBullet>

      <DocHeading>Πληροφορίες που δημιουργούνται όταν χρησιμοποιείτε την εφαρμογή</DocHeading>
      <DocBullet>
        Κρατήσεις: ποιο γήπεδο, ποια μέρα και ώρα κλείνετε ή στην οποία συμμετέχετε.
      </DocBullet>
      <DocBullet>
        Ομάδες και πρωταθλήματα: σε ποιες ομάδες είστε, βαθμολογίες πρωταθλημάτων και
        αποτελέσματα αγώνων.
      </DocBullet>
      <DocBullet>
        Αναρτήσεις ομάδας: αναρτήσεις «ζητούνται παίκτες» και «ζητείται αντίπαλος» που
        δημιουργείτε ή στις οποίες απαντάτε.
      </DocBullet>
      <DocBullet>
        Μηνύματα: μηνύματα μεταξύ αρχηγών ομάδων για να κανονίσουν έναν αγώνα, που τα βλέπουν μόνο
        οι δύο αρχηγοί.
      </DocBullet>
      <DocBullet>Ακολουθήσεις: ποιους παίκτες ή ποιες ομάδες ακολουθείτε.</DocBullet>
      <DocBullet>
        Futty AI: οι ερωτήσεις σας, οι φωτογραφίες που επισυνάπτετε και οι απαντήσεις (δείτε
        «Futty AI» παρακάτω).
      </DocBullet>
      <DocBullet>
        Τοποθεσία (προαιρετικά): μόνο όταν πατάτε «Around me», στρογγυλεμένη σε περίπου 1 χλμ., για
        να ταξινομηθούν τα γήπεδα κατά απόσταση στο κινητό σας. Δεν αποστέλλεται ποτέ σε εμάς ούτε
        αποθηκεύεται.
      </DocBullet>

      <DocHeading>Στοιχεία αγώνων</DocHeading>
      <DocParagraph>Όταν παίζετε σε αγώνα που κλείστηκε ή οργανώθηκε στο Futty, κρατάμε:</DocParagraph>
      <DocBullet>
        Check-in: αν κάνατε check-in, πότε και πώς (σκανάρατε τον κωδικό του γηπέδου, σας σημείωσε
        ο αρχηγός σας ή σας σημείωσε το γήπεδο ως παρόντα). Μόνο οι παίκτες που έκαναν check-in
        μετράνε στα στατιστικά, στον καλύτερο παίκτη του αγώνα, στις βαθμολογίες και στα επίπεδα.
      </DocBullet>
      <DocBullet>Γκολ, ασίστ και συνθέσεις που καταχωρούνται για τον αγώνα.</DocBullet>
      <DocBullet>
        Ψήφους για τον καλύτερο παίκτη του αγώνα και τις βαθμολογίες (από 1 έως 10) που δίνετε σε
        άλλους παίκτες.
      </DocBullet>
      <DocBullet>
        Το επίπεδό σας και το ιστορικό του, που υπολογίζει το Futty από τα αποτελέσματα και τις
        βαθμολογίες, καθώς και τις απαντήσεις σας στις ερωτήσεις επιπέδου.
      </DocBullet>
      <DocBullet>
        Στατιστικά: στατιστικά σεζόν, κατατάξεις και ομάδα της εβδομάδας, από επιβεβαιωμένους
        αγώνες.
      </DocBullet>
      <DocParagraph>Ποιος τα βλέπει:</DocParagraph>
      <DocBullet>
        Κανείς δεν βλέπει ποιος ψήφισε ποιον ή τι βαθμό έδωσε ένας παίκτης σε άλλον. Εσείς βλέπετε
        μόνο τη δική σας ψήφο και τις δικές σας βαθμολογίες.
      </DocBullet>
      <DocBullet>
        Τη σελίδα του αγώνα (σκορ, γκολ, συνθέσεις, τη βαθμολογία κάθε παίκτη όταν υπάρχουν αρκετές
        βαθμολογίες, και τον καλύτερο παίκτη όταν κλείσει η ψηφοφορία) τη βλέπουν οι παίκτες του
        αγώνα, και όλοι οι συνδεδεμένοι χρήστες όταν επιβεβαιωθεί το αποτέλεσμα.
      </DocBullet>
      <DocBullet>Τα check-in τα βλέπουν οι παίκτες του αγώνα και το προσωπικό του γηπέδου.</DocBullet>
      <DocBullet>
        Τα επίπεδα, τα στατιστικά σεζόν, τις κατατάξεις και την ομάδα της εβδομάδας τα βλέπουν όλοι
        οι συνδεδεμένοι χρήστες.
      </DocBullet>
      <DocBullet>Τις απαντήσεις σας στις ερωτήσεις επιπέδου τις βλέπετε μόνο εσείς.</DocBullet>

      <DocHeading>Τι βλέπουν τα γήπεδα</DocHeading>
      <DocParagraph>Το προσωπικό ενός γηπέδου βλέπει, μόνο για το δικό του γήπεδο:</DocParagraph>
      <DocBullet>τις κρατήσεις σας σε αυτό το γήπεδο και τους παίκτες τους·</DocBullet>
      <DocBullet>τι πληρώσατε σε αυτό το γήπεδο και πώς·</DocBullet>
      <DocBullet>ό,τι οφείλετε σε αυτό το γήπεδο·</DocBullet>
      <DocBullet>
        αν κάνατε check-in, και πόσες φορές είχατε θέση σε κράτηση και δεν εμφανιστήκατε.
      </DocBullet>
      <DocParagraph>
        Ένα γήπεδο δεν βλέπει ποτέ τις κρατήσεις, τις πληρωμές, τις οφειλές ή τις μη εμφανίσεις σας
        σε άλλο γήπεδο.
      </DocParagraph>
      <DocParagraph>
        Όταν ανοίγετε μια προσφορά του γηπέδου μετά τον αγώνα, το Futty δημιουργεί έναν κωδικό για
        εσάς. Το γήπεδο βλέπει σε τι αντιστοιχεί ο κωδικός, πόσοι κωδικοί ανοίχτηκαν και ποιοι
        χρησιμοποιήθηκαν στο ταμείο του. Αυτοί οι αριθμοί μένουν στο γήπεδο αν διαγράψετε τον
        λογαριασμό σας, αλλά δεν συνδέονται πια με εσάς.
      </DocParagraph>

      <DocHeading>Παίκτες που προτείνει το γήπεδο</DocHeading>
      <DocParagraph>
        Ένα γήπεδο μπορεί να προτείνει έναν παίκτη που δεν είναι στο Futty σε ομάδα που της λείπουν
        παίκτες. Το προσωπικό γράφει μόνο το μικρό όνομα του παίκτη. Δεν υπάρχει λογαριασμός, email
        ή τηλέφωνο, και το Futty δεν επικοινωνεί ποτέ με αυτόν τον παίκτη. Το όνομα το βλέπουν το
        προσωπικό του γηπέδου, αυτός που έκανε την κράτηση και, αφού εκείνος δεχτεί, οι άλλοι παίκτες
        της κράτησης.
      </DocParagraph>

      <DocHeading>Κάμερα</DocHeading>
      <DocParagraph>
        Αν το επιτρέψετε, το Futty χρησιμοποιεί την κάμερα μόνο για να σκανάρει τον κωδικό QR του
        γηπέδου για check-in σε αγώνα. Η εικόνα διαβάζεται στο τηλέφωνό σας για να βρεθεί ο κωδικός
        και δεν αποθηκεύεται ούτε αποστέλλεται· αποστέλλεται μόνο ο κωδικός για να γίνει το
        check-in. Μπορείτε επίσης να πληκτρολογήσετε τον κωδικό.
      </DocParagraph>

      <DocHeading>Φωτογραφίες</DocHeading>
      <DocParagraph>
        Το προσωπικό ενός γηπέδου μπορεί να επιλέξει φωτογραφίες από το τηλέφωνό του για να
        προσθέσει εικόνες του γηπέδου και του μενού του. Πριν από την πρώτη μεταφόρτωση, το
        προσωπικό επιβεβαιώνει ότι οι φωτογραφίες ανήκουν στο γήπεδο και ότι το Futty μπορεί να τις
        δείχνει. Το Futty ανεβάζει μόνο τις φωτογραφίες που επιλέγει το προσωπικό, σε μικρότερο
        μέγεθος, και τις δείχνει στους παίκτες μέσα στην εφαρμογή. Το Futty δεν διαβάζει ποτέ τις
        φωτογραφίες των παικτών.
      </DocParagraph>

      <DocHeading>Επαφές</DocHeading>
      <DocParagraph>
        Αν το επιτρέψετε, η καρτέλα Community διαβάζει τους αριθμούς τηλεφώνου στις επαφές της
        συσκευής σας και τους ελέγχει με τους λογαριασμούς του Futty, για να σας δείξει ποιες επαφές
        σας χρησιμοποιούν ήδη την εφαρμογή. Οι αριθμοί στέλνονται στον διακομιστή μας μόνο για αυτόν
        τον έλεγχο και δεν αποθηκεύονται.
      </DocParagraph>

      <DocHeading>Ημερολόγιο</DocHeading>
      <DocParagraph>
        Αν επιλέξετε να προσθέσετε μια κράτηση στο ημερολόγιό σας, το Futty γράφει αυτό το γεγονός
        στο ημερολόγιο του τηλεφώνου σας και θυμάται, μόνο στο τηλέφωνό σας, ποιο γεγονός πρόσθεσε.
        Το Futty δεν διαβάζει τα άλλα γεγονότα σας και δεν τα στέλνει πουθενά.
      </DocParagraph>

      <DocHeading>Ειδοποιήσεις</DocHeading>
      <DocParagraph>
        Αν ενεργοποιήσετε τις ειδοποιήσεις, αποθηκεύεται το διακριτικό ειδοποιήσεων της συσκευής
        σας, ώστε να σας ενημερώνουμε για τις κρατήσεις, τους αγώνες και τις αναρτήσεις ομάδων. Αν
        προσθέσετε τον αριθμό σας στο WhatsApp και επιλέξετε WhatsApp για υπενθυμίσεις, αποθηκεύουμε
        αυτόν τον αριθμό και στέλνουμε αυτές τις υπενθυμίσεις μέσω WhatsApp· απαντήστε STOP για να
        σταματήσουν. Μπορείτε να απενεργοποιήσετε κάθε είδος οποιαδήποτε στιγμή από Account &gt;
        Settings &gt; Notifications.
      </DocParagraph>

      <DocHeading>Κλείδωμα με βιομετρικά</DocHeading>
      <DocParagraph>
        Το κλείδωμα της εφαρμογής με Face ID ή δακτυλικό αποτύπωμα γίνεται εξ ολοκλήρου στη συσκευή
        σας, από τα βιομετρικά συστήματα του iOS και του Android. Το Futty δεν λαμβάνει, δεν
        αποθηκεύει και δεν στέλνει ποτέ βιομετρικά σας δεδομένα· η εφαρμογή μαθαίνει μόνο
        «ξεκλειδώθηκε» ή «δεν ξεκλειδώθηκε».
      </DocParagraph>

      <DocHeading>Πληρωμές</DocHeading>
      <DocParagraph>
        Το Futty Premium (προσωπικό και ομάδας) αγοράζεται μέσω του App Store της Apple. Οι
        κρατήσεις γηπέδων πληρώνονται με κάρτα μέσω της Stripe. Και στις δύο περιπτώσεις τα
        στοιχεία της κάρτας σας τα χειρίζεται ο πάροχος πληρωμών· το Futty δεν βλέπει και δεν
        αποθηκεύει ποτέ ολόκληρο τον αριθμό της κάρτας σας. Κρατάμε αρχείο για το τι πληρώσατε,
        πόσα, και σε τι κατάσταση είναι η πληρωμή (δεσμευμένη, χρεωμένη, επιστραμμένη).
      </DocParagraph>

      <DocHeading>Με ποιους μοιραζόμαστε τις πληροφορίες σας</DocHeading>
      <DocBullet>
        Άλλοι χρήστες: το όνομα χρήστη σας, και όσα στοιχεία του προφίλ έχετε επιλέξει να φαίνονται,
        τα βλέπουν οι άλλοι συνδεδεμένοι χρήστες (είναι εφαρμογή κοινότητας· η αναζήτηση παικτών και
        ομάδων είναι βασική λειτουργία). Το email σας και ο αριθμός τηλεφώνου σας (εκτός αν το
        επιλέξετε) δεν εμφανίζονται ποτέ σε άλλους χρήστες.
      </DocBullet>
      <DocBullet>Γήπεδα: όπως περιγράφεται στο «Τι βλέπουν τα γήπεδα».</DocBullet>
      <DocBullet>
        Πάροχοι υπηρεσιών: η εφαρμογή βασίζεται στα Supabase (βάση δεδομένων, σύνδεση, φιλοξενία),
        Expo/EAS (υποδομή εφαρμογής, αποστολή ειδοποιήσεων), Stripe (πληρωμές με κάρτα), Apple
        (αγορές στο App Store), Sentry (αναφορές σφαλμάτων, που περιλαμβάνουν τεχνικές πληροφορίες
        της συσκευής), Anthropic (επεξεργάζεται τα μηνύματα και τις φωτογραφίες του Futty AI για να
        δώσει απαντήσεις) και
        Meta (στέλνει τις υπενθυμίσεις WhatsApp, αν τις επιλέξετε). Αυτοί οι πάροχοι επεξεργάζονται
        δεδομένα για λογαριασμό μας.
      </DocBullet>
      <DocBullet>
        Δεν πουλάμε τα δεδομένα σας και δεν χρησιμοποιούμε εργαλεία διαφήμισης ή παρακολούθησης
        τρίτων.
      </DocBullet>

      <DocHeading>Αποκλεισμός και αναφορές</DocHeading>
      <DocParagraph>
        Μπορείτε να αποκλείσετε έναν άλλο χρήστη μέσα από την εφαρμογή, ώστε να μη βλέπετε τα
        μηνύματα και τις αναρτήσεις του. Μπορείτε επίσης να αναφέρετε έναν χρήστη ή κάποιο
        περιεχόμενο· τις αναφορές τις εξετάζει ο προγραμματιστής της εφαρμογής.
      </DocParagraph>

      <DocHeading>Ηλικία και νεαροί παίκτες</DocHeading>
      <DocBullet>Πρέπει να είστε 14 ετών και άνω για να χρησιμοποιείτε το Futty.</DocBullet>
      <DocBullet>
        Οι παίκτες κάτω των 18 (με τη σημερινή ημερομηνία στην Κύπρο) εμφανίζονται στους άλλους
        παίκτες μόνο με το μικρό τους όνομα και δεν εμφανίζονται στην αναζήτηση παικτών των
        ενηλίκων.
      </DocBullet>
      <DocBullet>
        Ενήλικες και παίκτες κάτω των 18 δεν μπορούν να στείλουν ο ένας στον άλλον αιτήματα φιλίας
        ή ιδιωτικά μηνύματα.
      </DocBullet>
      <DocBullet>
        Στη συνομιλία αγώνα, τα μηνύματα απενεργοποιούνται όταν κάποιος από τους δύο αρχηγούς είναι
        κάτω των 18. Οι προτάσεις ημερομηνίας και τα σκορ συνεχίζουν να λειτουργούν.
      </DocBullet>
      <DocBullet>
        Μια αναφορά που αφορά παίκτη κάτω των 18 σημειώνεται ως επείγουσα και στέλνεται αμέσως στους
        ιδρυτές.
      </DocBullet>

      <DocHeading>Μηνύματα και φίλοι</DocHeading>
      <DocBullet>
        Οι αρχηγοί δύο ομάδων στο ίδιο πρωτάθλημα μπορούν να στέλνουν μηνύματα ο ένας στον άλλον. Οι
        φίλοι μπορούν να στέλνουν μηνύματα ο ένας στον άλλον όσο είναι φίλοι.
      </DocBullet>
      <DocBullet>
        Τα μηνύματα είναι μόνο κείμενο, έως 1.000 χαρακτήρες. Αποθηκεύονται στους διακομιστές μας,
        ώστε να τα διαβάζουν και οι δύο πλευρές και να μπορούμε να εξετάσουμε μια αναφορά.
      </DocBullet>
      <DocBullet>
        Η άλλη πλευρά βλέπει πότε ένα μήνυμα έφτασε στο κινητό σας και πότε το διαβάσατε.
      </DocBullet>
      <DocBullet>Ο αποκλεισμός ενός παίκτη σταματά τα μηνύματα και προς τις δύο κατευθύνσεις.</DocBullet>
      <DocBullet>
        Για την αποφυγή ανεπιθύμητων μηνυμάτων, κάθε παίκτης μπορεί να στείλει έως 30 μηνύματα το
        λεπτό και 500 μέσα σε 24 ώρες.
      </DocBullet>
      <DocBullet>
        Αν διαγράψετε τον λογαριασμό σας, τα μηνύματά σας μένουν στη συνομιλία του άλλου παίκτη ως
        «Former player».
      </DocBullet>
      <DocBullet>
        Ένα νέο μήνυμα στέλνει ειδοποίηση, την οποία μπορείτε να απενεργοποιήσετε από τις Ρυθμίσεις.
      </DocBullet>

      <DocHeading>Futty AI</DocHeading>
      <DocBullet>
        Οι συνομιλίες σας με το Futty AI και οι φωτογραφίες που επισυνάπτετε αποθηκεύονται στους
        διακομιστές μας, ώστε να μπορείτε να τις ξαναδιαβάσετε. Μόνο εσείς τις βλέπετε.
      </DocBullet>
      <DocBullet>
        Οι φωτογραφίες μικραίνουν στο κινητό σας και στέλνονται μόνο στο Futty και στην Anthropic, τον
        πάροχο τεχνητής νοημοσύνης που γράφει τις απαντήσεις.
      </DocBullet>
      <DocBullet>
        Οι συνομιλίες και οι φωτογραφίες τους διαγράφονται αυτόματα 7 ημέρες μετά το τελευταίο
        μήνυμα, και αμέσως αν διαγράψετε τον λογαριασμό σας.
      </DocBullet>

      <DocHeading>Οι επιλογές σας</DocHeading>
      <DocBullet>
        Μπορείτε να αλλάξετε ή να αφαιρέσετε τα περισσότερα στοιχεία του προφίλ σας οποιαδήποτε
        στιγμή από το Edit Profile.
      </DocBullet>
      <DocBullet>
        Μπορείτε να απενεργοποιήσετε τις ειδοποιήσεις και την εμφάνιση του αριθμού σας οποιαδήποτε
        στιγμή.
      </DocBullet>
      <DocBullet>
        Μπορείτε να διαγράψετε τον λογαριασμό σας οποιαδήποτε στιγμή από Account &gt; Settings &gt;
        Delete account. Έτσι διαγράφονται η σύνδεσή σας, τα στοιχεία του προφίλ σας και οι
        αποθηκευμένες κάρτες σας. Τα αποτελέσματα αγώνων στους οποίους πήρατε μέρος μένουν στις
        βαθμολογίες ως «Deleted player», ώστε να μένουν σωστά τα στοιχεία των άλλων ομάδων.
        Μπορείτε επίσης να μας το ζητήσετε με email.
      </DocBullet>

      <DocHeading>Αλλαγές σε αυτή την πολιτική</DocHeading>
      <DocParagraph>
        Αν αυτή η πολιτική αλλάξει ουσιαστικά, θα ενημερώσουμε την ημερομηνία «Τελευταία ενημέρωση»
        παραπάνω.
      </DocParagraph>

      <DocHeading>Επικοινωνία</DocHeading>
      <DocParagraph>Ερωτήσεις για αυτή την πολιτική ή για τα δεδομένα σας:</DocParagraph>
      <DocEmailLink email={CONTACT_EMAIL} />
    </DocScreen>
  );
}
